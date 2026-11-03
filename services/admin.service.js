import { randomUUID } from "node:crypto";
import {
  COMPANY_EMAIL_DOMAIN,
  updateAccountProfile,
  verifyAccountPassword,
} from "./account.service.js";
import { AccountError } from "./errors.js";
import { withDatabase } from "./json-database.service.js";
import { initializeMailbox } from "./mailbox-json.service.js";

const ACCOUNT_STATUSES = new Set(["approved", "rejected", "suspended"]);
const PASSWORD_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_PASSWORD_ATTEMPTS = 5;
const passwordAttempts = new Map();

function publicAdminUser(user, mailbox = {}) {
  const messages = mailbox.messages ?? [];
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role ?? "member",
    status: user.status ?? "pending",
    position: user.position ?? "",
    avatarSticker: user.avatarSticker ?? "",
    profilePhoto: user.profilePhoto ?? "",
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    messageCount: messages.length,
    sentCount: messages.filter((message) => message.folder === "sent").length,
    draftCount: (mailbox.drafts ?? []).length,
  };
}

function resolveRegistrationNotifications(database, userId, readAt) {
  for (const notification of database.notifications) {
    if (notification.userId === userId && notification.type === "registration_pending") {
      notification.readAt = readAt;
    }
  }
}

function addAuditEntry(database, entry) {
  database.adminAuditLog.push({ id: `audit-${randomUUID()}`, ...entry });
  if (database.adminAuditLog.length > 1000) {
    database.adminAuditLog.splice(0, database.adminAuditLog.length - 1000);
  }
}

export async function getAdminOverview() {
  return withDatabase((database) => {
    const users = database.users.map((user) =>
      publicAdminUser(user, database.mailboxes[user.id]),
    );
    const messages = users.reduce((sum, user) => sum + user.messageCount, 0);
    const sent = users.reduce((sum, user) => sum + user.sentCount, 0);
    const drafts = users.reduce((sum, user) => sum + user.draftCount, 0);
    const pending = users.filter((user) => user.status === "pending").length;
    const pendingUserIds = new Set(
      users.filter((user) => user.status === "pending").map((user) => user.id),
    );
    return {
      stats: {
        users: users.length,
        approved: users.filter((user) => user.status === "approved").length,
        pending,
        suspended: users.filter((user) => user.status === "suspended").length,
        messages,
        sent,
        drafts,
      },
      users: users.sort((first, second) =>
        new Date(second.createdAt) - new Date(first.createdAt),
      ),
      notifications: database.notifications
        .filter((notification) =>
          notification.type === "registration_pending" &&
          !notification.readAt &&
          pendingUserIds.has(notification.userId),
        )
        .slice(-20)
        .reverse()
        .map(({ id, title, message, createdAt, userId }) => ({
          id,
          title,
          message,
          createdAt,
          userId,
        })),
      auditLog: database.adminAuditLog
        .slice(-30)
        .reverse()
        .map((entry) => ({ ...entry })),
    };
  });
}

export async function getManagedAccountProfile(userId) {
  return withDatabase((database) => {
    const user = database.users.find((item) => item.id === userId);
    if (!user) throw new AccountError("That account could not be found.", 404);
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      bio: user.bio ?? "",
      phone: user.phone ?? "",
      location: user.location ?? "",
      position: user.position ?? "",
      profilePhoto: user.profilePhoto ?? "",
      avatarSticker: user.avatarSticker ?? "",
      role: user.role ?? "member",
      status: user.status ?? "pending",
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  });
}

export async function verifyAdminActionPassword(actorId, password) {
  const now = Date.now();
  const attempts = (passwordAttempts.get(actorId) ?? [])
    .filter((timestamp) => now - timestamp < PASSWORD_ATTEMPT_WINDOW_MS);
  if (attempts.length >= MAX_PASSWORD_ATTEMPTS) {
    passwordAttempts.set(actorId, attempts);
    throw new AccountError("Too many password confirmation failures. Wait 15 minutes and try again.", 429);
  }
  try {
    await verifyAccountPassword(actorId, password);
    passwordAttempts.delete(actorId);
  } catch (error) {
    if (error instanceof AccountError && error.status === 403) {
      attempts.push(now);
      passwordAttempts.set(actorId, attempts);
    }
    throw error;
  }
}

export async function updateManagedAccountProfile(actor, userId, profile) {
  await verifyAdminActionPassword(actor.id, profile.password);
  await updateAccountProfile(userId, {
    name: profile.name,
    email: profile.email,
    bio: profile.bio,
    phone: profile.phone,
    location: profile.location,
    position: profile.position,
    avatarSticker: profile.avatarSticker,
  });
  await withDatabase((database) => {
    const currentActor = database.users.find((item) => item.id === actor.id);
    if (
      !currentActor ||
      (currentActor.role ?? "member") !== "admin" ||
      (currentActor.status ?? "pending") !== "approved"
    ) {
      throw new AccountError("Admin access is no longer available.", 403);
    }
    const target = database.users.find((item) => item.id === userId);
    if (!target) throw new AccountError("That account could not be found.", 404);
    addAuditEntry(database, {
      actorId: currentActor.id,
      actorName: currentActor.name,
      actorEmail: currentActor.email,
      targetId: target.id,
      targetName: target.name,
      targetEmail: target.email,
      action: "profile_updated",
      previousStatus: target.status ?? "pending",
      status: target.status ?? "pending",
      reason: "Updated employee profile details.",
      createdAt: target.updatedAt,
    });
  });
  return getManagedAccountProfile(userId);
}

export async function updateManagedAccountStatus(actor, userId, { status, password, reason }) {
  if (!ACCOUNT_STATUSES.has(status)) {
    throw new AccountError("Choose approve, reject, or suspend.");
  }
  if (reason !== undefined && (typeof reason !== "string" || reason.length > 500)) {
    throw new AccountError("The audit note must be 500 characters or fewer.");
  }
  const normalizedReason = typeof reason === "string" ? reason.trim() : "";
  if (["rejected", "suspended"].includes(status) && normalizedReason.length < 5) {
    throw new AccountError("Add a short reason before rejecting or suspending an account.");
  }

  await verifyAdminActionPassword(actor.id, password);
  return withDatabase((database) => {
    const user = database.users.find((item) => item.id === userId);
    if (!user) throw new AccountError("That account could not be found.", 404);
    const currentActor = database.users.find((item) => item.id === actor.id);
    if (
      !currentActor ||
      (currentActor.role ?? "member") !== "admin" ||
      (currentActor.status ?? "pending") !== "approved"
    ) {
      throw new AccountError("Admin access is no longer available.", 403);
    }
    if ((user.role ?? "member") === "admin") {
      throw new AccountError("Admin accounts cannot be changed from this dashboard.", 403);
    }
    if (actor.id === userId) {
      throw new AccountError("You cannot change your own account status.", 403);
    }

    const previousStatus = user.status ?? "pending";
    if (previousStatus === status) return publicAdminUser(user, database.mailboxes[user.id]);
    user.status = status;
    user.updatedAt = new Date().toISOString();
    if (status === "approved") initializeMailbox(database, user);
    if (status !== "approved") {
      database.sessions = database.sessions.filter((session) => session.userId !== user.id);
    }

    const statusMessages = {
      approved: "Your BeOneOfUs Mail account has been approved.",
      rejected: "Your BeOneOfUs Mail access request was not approved.",
      suspended: "Your BeOneOfUs Mail account has been suspended. Contact an administrator for help.",
    };
    database.notifications.push({
      id: `notification-${randomUUID()}`,
      type: "account_status",
      userId: user.id,
      title: "Account status updated",
      message: statusMessages[status],
      createdAt: user.updatedAt,
      readAt: null,
    });
    resolveRegistrationNotifications(database, user.id, user.updatedAt);
    addAuditEntry(database, {
      actorId: currentActor.id,
      actorName: currentActor.name,
      actorEmail: currentActor.email,
      targetId: user.id,
      targetName: user.name,
      targetEmail: user.email,
      action: "account_status_changed",
      previousStatus,
      status,
      reason: normalizedReason,
      createdAt: user.updatedAt,
    });
    return publicAdminUser(user, database.mailboxes[user.id]);
  });
}

export async function getAndMarkUserNotifications(userId) {
  return withDatabase((database) => {
    const now = new Date().toISOString();
    const notifications = database.notifications
      .filter((notification) => notification.userId === userId && notification.type === "account_status")
      .slice(-10)
      .reverse()
      .map((notification) => ({
        id: notification.id,
        title: notification.title,
        message: notification.message,
        createdAt: notification.createdAt,
        unread: !notification.readAt,
      }));
    const newestUnread = database.notifications.findLast((notification) =>
      notification.userId === userId &&
      notification.type === "account_status" &&
      !notification.readAt,
    );
    if (newestUnread) {
      newestUnread.readAt = now;
    }
    return notifications;
  });
}

export async function promoteAccountToAdmin(email) {
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!normalizedEmail.endsWith(`@${COMPANY_EMAIL_DOMAIN}`)) {
    throw new AccountError(`Only a BeOneOfUs company address (@${COMPANY_EMAIL_DOMAIN}) can be promoted.`, 400);
  }
  return withDatabase((database) => {
    const user = database.users.find((item) => item.email === normalizedEmail);
    if (!user) throw new AccountError("Register the company account before promoting it.", 404);
    const previousStatus = user.status ?? "pending";
    user.role = "admin";
    user.status = "approved";
    user.updatedAt = new Date().toISOString();
    initializeMailbox(database, user);
    resolveRegistrationNotifications(database, user.id, user.updatedAt);
    if (previousStatus !== "approved") {
      database.notifications.push({
        id: `notification-${randomUUID()}`,
        type: "account_status",
        userId: user.id,
        title: "Account status updated",
        message: "Your BeOneOfUs Mail account has been approved.",
        createdAt: user.updatedAt,
        readAt: null,
      });
    }
    addAuditEntry(database, {
      actorId: "server-operator",
      actorName: "Server operator",
      actorEmail: "operator",
      targetId: user.id,
      targetName: user.name,
      targetEmail: user.email,
      action: "admin_promoted",
      previousStatus,
      status: user.status,
      reason: "Promoted with the server operator command.",
      createdAt: user.updatedAt,
    });
    return { id: user.id, email: user.email, role: user.role, status: user.status };
  });
}
