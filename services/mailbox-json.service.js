import { randomUUID } from "node:crypto";
import { createInitialMailbox } from "../public/js/mailbox-data.js";
import { AccountError } from "./errors.js";
import { COMPANY_EMAIL_DOMAIN } from "./account.service.js";
import { withDatabase } from "./json-database.service.js";

const MAX_MESSAGES = 5000;
const MAX_DRAFTS = 1000;
const MAX_LABELS = 100;
const MAX_MAILBOX_LENGTH = 10 * 1024 * 1024;
const MAX_MESSAGE_BODY_LENGTH = 20_000;
const MAX_ATTACHMENTS = 30;
const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024;
const MAX_ATTACHMENTS_SIZE = 15 * 1024 * 1024;
const MAX_MAILBOX_ATTACHMENT_STORAGE = 100 * 1024 * 1024;
const PREVIEWABLE_IMAGE_TYPES = new Set([
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function initializeMailbox(database, user) {
  if (database.mailboxes[user.id]) return database.mailboxes[user.id];
  const mailbox = structuredClone(createInitialMailbox());
  for (const message of mailbox.messages) {
    message.body = message.body.map((paragraph) => paragraph.replaceAll("Maya", user.name));
    message.preview = message.preview.replaceAll("Maya", user.name);
  }
  database.mailboxes[user.id] = mailbox;
  return mailbox;
}

export async function getMailbox(userId) {
  return withDatabase((database) => {
    const user = database.users.find((item) => item.id === userId);
    if (!user) throw new AccountError("Your account could not be found.", 404);
    const mailbox = initializeMailbox(database, user);
    return mailboxWithAttachmentAvailability(database, mailbox);
  });
}

function mailboxWithAttachmentAvailability(database, mailbox) {
  const result = structuredClone(mailbox);
  for (const message of result.messages) {
    for (const attachment of message.attachments ?? []) {
      attachment.available = Boolean(database.attachmentFiles?.[attachment.id]);
      attachment.previewable = PREVIEWABLE_IMAGE_TYPES.has(attachment.type);
    }
  }
  return result;
}

function recordAdminMailAction(database, actor, target, action) {
  const entry = {
    id: `audit-${randomUUID()}`,
    actorId: actor.id,
    actorName: actor.name,
    actorEmail: actor.email,
    targetId: target.id,
    targetName: target.name,
    targetEmail: target.email,
    action,
    createdAt: new Date().toISOString(),
  };
  database.adminAuditLog.push(entry);
  if (database.adminAuditLog.length > 1000) {
    database.adminAuditLog.splice(0, database.adminAuditLog.length - 1000);
  }
}

function assertCurrentAdmin(database, actor) {
  const currentActor = database.users.find((user) => user.id === actor?.id);
  if (
    !currentActor ||
    (currentActor.role ?? "member") !== "admin" ||
    (currentActor.status ?? "pending") !== "approved"
  ) {
    throw new AccountError("Admin access is no longer available.", 403);
  }
  return currentActor;
}

function assertCurrentApprovedUser(database, actor) {
  const currentActor = database.users.find((user) => user.id === actor?.id);
  if (!currentActor || (currentActor.status ?? "pending") !== "approved") {
    throw new AccountError("Your account is no longer approved to send mail.", 403);
  }
  return currentActor;
}

function removeUnreferencedAttachmentFiles(database) {
  const referencedIds = new Set(
    Object.values(database.mailboxes).flatMap((mailbox) =>
      mailbox.messages.flatMap((message) =>
        (message.attachments ?? []).map((attachment) => attachment.id),
      ),
    ),
  );
  for (const id of Object.keys(database.attachmentFiles ?? {})) {
    if (!referencedIds.has(id)) delete database.attachmentFiles[id];
  }
}

function validateMailbox(mailbox) {
  if (
    !mailbox ||
    typeof mailbox !== "object" ||
    !Array.isArray(mailbox.messages) ||
    !Array.isArray(mailbox.drafts) ||
    !Array.isArray(mailbox.labels)
  ) {
    throw new AccountError("Mailbox data is invalid.");
  }
  if (
    mailbox.messages.length > MAX_MESSAGES ||
    mailbox.drafts.length > MAX_DRAFTS ||
    mailbox.labels.length > MAX_LABELS
  ) {
    throw new AccountError("Mailbox contains too many items.");
  }
  if (Buffer.byteLength(JSON.stringify(mailbox), "utf8") > MAX_MAILBOX_LENGTH) {
    throw new AccountError("Mailbox data is too large to save.", 413);
  }
  for (const message of [...mailbox.messages, ...mailbox.drafts]) {
    if (!message || typeof message !== "object" || typeof message.id !== "string" || message.id.length > 160) {
      throw new AccountError("Mailbox contains an invalid message.");
    }
    for (const address of [message.recipientEmail, message.to]) {
      if (address === undefined || address === null || address === "") continue;
      if (
        typeof address !== "string" ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.trim()) ||
        !address.trim().toLowerCase().endsWith(`@${COMPANY_EMAIL_DOMAIN}`)
      ) throw new AccountError("BeOneOfUs Mail only allows company email addresses.");
    }
  }
  for (const label of mailbox.labels) {
    if (!label || typeof label.name !== "string" || label.name.length > 32) {
      throw new AccountError("Mailbox contains an invalid label.");
    }
  }
}

export async function saveMailbox(userId, mailbox) {
  validateMailbox(mailbox);
  return withDatabase((database) => {
    const user = database.users.find((item) => item.id === userId);
    if (!user) throw new AccountError("Your account could not be found.", 404);
    if (mailbox.messages.some((message) =>
      message.folder === "sent" &&
      (typeof message.senderEmail !== "string" ||
        message.senderEmail.trim().toLowerCase() !== user.email),
    )) {
      throw new AccountError("Sent messages must use your approved company address.", 403);
    }
    database.mailboxes[userId] = structuredClone(mailbox);
    removeUnreferencedAttachmentFiles(database);
    return { savedAt: new Date().toISOString() };
  });
}

function normalizeAttachments(attachments) {
  if (attachments === undefined) return [];
  if (!Array.isArray(attachments) || attachments.length > MAX_ATTACHMENTS) {
    throw new AccountError("Message attachments are invalid.");
  }
  let totalSize = 0;
  return attachments.map((attachment) => {
    if (
      !attachment ||
      (attachment.id !== undefined &&
        (typeof attachment.id !== "string" || attachment.id.length > 160)) ||
      typeof attachment.name !== "string" ||
      attachment.name.trim().length === 0 ||
      attachment.name.length > 255 ||
      typeof attachment.type !== "string" ||
      attachment.type.length > 128 ||
      !Number.isInteger(attachment.size) ||
      attachment.size < 0 ||
      attachment.size > MAX_ATTACHMENT_SIZE
    ) {
      throw new AccountError("Message attachments are invalid.");
    }
    totalSize += attachment.size;
    if (totalSize > MAX_ATTACHMENTS_SIZE) {
      throw new AccountError("Attachments are limited to 15 MB per message.");
    }
    if (typeof attachment.content !== "string") {
      throw new AccountError(`The file "${attachment.name}" has no uploaded content.`);
    }
    const encoded = attachment.content.replace(/\s/g, "");
    if (
      encoded.length > Math.ceil(MAX_ATTACHMENT_SIZE / 3) * 4 ||
      encoded.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
    ) {
      throw new AccountError(`The file "${attachment.name}" is invalid or too large.`);
    }
    const content = Buffer.from(encoded, "base64");
    if (content.length !== attachment.size || content.length > MAX_ATTACHMENT_SIZE) {
      throw new AccountError(`The file "${attachment.name}" did not upload completely.`);
    }
    return {
      id: `attachment-${randomUUID()}`,
      name: attachment.name.trim(),
      type: attachment.type.trim().toLowerCase() || "application/octet-stream",
      size: content.length,
      content: content.toString("base64"),
    };
  });
}

export async function sendMailboxMessage(senderId, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AccountError("Message details are invalid.");
  }

  const recipientEmail = typeof input.recipientEmail === "string"
    ? input.recipientEmail.trim().toLowerCase()
    : "";
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail) ||
    !recipientEmail.endsWith(`@${COMPANY_EMAIL_DOMAIN}`)
  ) {
    throw new AccountError(`Use a BeOneOfUs company address (@${COMPANY_EMAIL_DOMAIN}).`);
  }
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  if (subject.length === 0 || subject.length > 200) {
    throw new AccountError("Enter a subject between 1 and 200 characters.");
  }
  const bodyText = typeof input.body === "string" ? input.body.trim() : "";
  if (bodyText.length === 0 || bodyText.length > MAX_MESSAGE_BODY_LENGTH) {
    throw new AccountError(`Message text must be between 1 and ${MAX_MESSAGE_BODY_LENGTH} characters.`);
  }
  const draftId = input.draftId === undefined ? null : input.draftId;
  if (draftId !== null && (typeof draftId !== "string" || draftId.length > 160)) {
    throw new AccountError("Draft details are invalid.");
  }
  const uploadedAttachments = normalizeAttachments(input.attachments);
  const attachments = uploadedAttachments.map(({ content: _content, ...attachment }) => ({
    ...attachment,
    available: true,
    previewable: PREVIEWABLE_IMAGE_TYPES.has(attachment.type),
  }));
  const body = bodyText.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);

  return withDatabase((database) => {
    const sender = database.users.find((user) => user.id === senderId);
    if (!sender || (sender.status ?? "pending") !== "approved") {
      throw new AccountError("Your account is not approved to send mail.", 403);
    }
    const recipient = database.users.find((user) => user.email === recipientEmail);
    if (!recipient || (recipient.status ?? "pending") !== "approved") {
      throw new AccountError("That recipient does not have an active BeOneOfUs Mail account.", 404);
    }
    if (recipient.id === sender.id) {
      throw new AccountError("Choose another active account as the recipient.");
    }

    const senderMailbox = initializeMailbox(database, sender);
    const recipientMailbox = initializeMailbox(database, recipient);
    if (senderMailbox.messages.length >= MAX_MESSAGES || recipientMailbox.messages.length >= MAX_MESSAGES) {
      throw new AccountError("A mailbox contains too many messages.");
    }
    const senderStorage = senderMailbox.messages.reduce(
      (total, message) => total + (message.attachments ?? []).reduce(
        (sum, attachment) => sum + (attachment.size ?? 0),
        0,
      ),
      0,
    );
    const recipientStorage = recipientMailbox.messages.reduce(
      (total, message) => total + (message.attachments ?? []).reduce(
        (sum, attachment) => sum + (attachment.size ?? 0),
        0,
      ),
      0,
    );
    const uploadSize = uploadedAttachments.reduce((sum, item) => sum + item.size, 0);
    if (
      senderStorage + uploadSize > MAX_MAILBOX_ATTACHMENT_STORAGE ||
      recipientStorage + uploadSize > MAX_MAILBOX_ATTACHMENT_STORAGE
    ) {
      throw new AccountError("A mailbox has reached its 100 MB attachment storage limit.", 413);
    }

    const createdAt = new Date().toISOString();
    const message = {
      id: `message-${randomUUID()}`,
      sender: sender.name,
      senderEmail: sender.email,
      recipientEmail: recipient.email,
      subject,
      preview: bodyText.replace(/\s+/g, " ").slice(0, 130),
      body,
      attachments,
      color: "lilac",
      category: "primary",
      labels: [],
      unread: false,
      starred: false,
      folder: "sent",
      createdAt,
      reactions: [],
    };
    const receivedMessage = { ...structuredClone(message), folder: "inbox", unread: true };
    senderMailbox.messages.push(message);
    recipientMailbox.messages.push(receivedMessage);
    database.attachmentFiles ??= {};
    for (const attachment of uploadedAttachments) {
      database.attachmentFiles[attachment.id] = {
        content: attachment.content,
        type: attachment.type,
        size: attachment.size,
        createdAt,
      };
    }
    if (draftId) senderMailbox.drafts = senderMailbox.drafts.filter((draft) => draft.id !== draftId);
    if ((sender.role ?? "member") === "admin") {
      recordAdminMailAction(database, sender, recipient, "mail_message_sent");
    }
    return { message: structuredClone(message) };
  });
}

export async function getMailboxAttachment(userId, messageId, attachmentId) {
  return withDatabase((database) => {
    const mailbox = database.mailboxes[userId];
    const message = mailbox?.messages.find((item) => item.id === messageId);
    if (!message) throw new AccountError("That message could not be found.", 404);
    const metadata = (message.attachments ?? []).find((item) => item.id === attachmentId);
    const file = database.attachmentFiles?.[attachmentId];
    if (!metadata || !file) throw new AccountError("That attachment is not available.", 404);
    return {
      content: Buffer.from(file.content, "base64"),
      type: PREVIEWABLE_IMAGE_TYPES.has(metadata.type) ? metadata.type : "application/octet-stream",
      name: metadata.name,
    };
  });
}

export async function getManagedMailbox(userId) {
  return withDatabase((database) => {
    const user = database.users.find((item) => item.id === userId);
    if (!user) throw new AccountError("That account could not be found.", 404);
    const mailbox = database.mailboxes[userId] ?? (
      (user.status ?? "pending") === "approved" ? initializeMailbox(database, user) : null
    );
    if (!mailbox) throw new AccountError("That account has no mailbox.", 404);
    return mailboxWithAttachmentAvailability(database, mailbox);
  });
}

export async function getManagedMailboxAttachment(userId, messageId, attachmentId) {
  return getMailboxAttachment(userId, messageId, attachmentId);
}

export async function updateManagedMailboxMessage(actor, userId, messageId, input) {
  return updateMailboxMessage(actor, userId, messageId, input, true);
}

export async function updateOwnSentMailboxMessage(actor, messageId, input) {
  return updateMailboxMessage(actor, actor?.id, messageId, input, false);
}

async function updateMailboxMessage(actor, userId, messageId, input, managed) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AccountError("Message updates are invalid.");
  }
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  const bodyText = typeof input.body === "string" ? input.body.trim() : "";
  if (subject.length === 0 || subject.length > 200) {
    throw new AccountError("Enter a subject between 1 and 200 characters.");
  }
  if (bodyText.length === 0 || bodyText.length > MAX_MESSAGE_BODY_LENGTH) {
    throw new AccountError(`Message text must be between 1 and ${MAX_MESSAGE_BODY_LENGTH} characters.`);
  }
  const body = bodyText.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);

  return withDatabase((database) => {
    const currentActor = managed
      ? assertCurrentAdmin(database, actor)
      : assertCurrentApprovedUser(database, actor);
    const ownerMailbox = database.mailboxes[userId];
    const owner = database.users.find((user) => user.id === userId);
    const selectedMessage = ownerMailbox?.messages.find((item) => item.id === messageId);
    if (!owner || !selectedMessage) throw new AccountError("That message could not be found.", 404);
    const recipient = !managed && database.users.find((user) =>
      user.email.toLocaleLowerCase() === selectedMessage.recipientEmail?.toLocaleLowerCase(),
    );
    const recipientCopy = recipient && database.mailboxes[recipient.id]?.messages.find((item) =>
      item.id === messageId &&
      item.senderEmail?.toLocaleLowerCase() === currentActor.email.toLocaleLowerCase() &&
      item.recipientEmail?.toLocaleLowerCase() === recipient.email.toLocaleLowerCase(),
    );
    if (
      !managed &&
      (
        owner.id !== currentActor.id ||
        selectedMessage.folder !== "sent" ||
        selectedMessage.senderEmail?.toLocaleLowerCase() !== currentActor.email.toLocaleLowerCase() ||
        !recipient ||
        !recipientCopy
      )
    ) {
      throw new AccountError("You can only edit messages you sent.", 403);
    }
    if (!Array.isArray(input.attachments) || input.attachments.length > MAX_ATTACHMENTS) {
      throw new AccountError("Message attachments are invalid.");
    }
    const previousAttachments = selectedMessage.attachments ?? [];
    const previousAttachmentIds = previousAttachments.map(({ id }) => id);
    const retainedAttachments = input.attachments.filter((item) => item && item.content === undefined);
    const retainedIds = new Set(retainedAttachments.map((item) => item.id));
    if (
      retainedAttachments.some((item) =>
        !previousAttachments.some((previous) =>
          previous.id === item.id &&
          previous.name === item.name &&
          previous.type === item.type &&
          previous.size === item.size,
        ),
      )
    ) {
      throw new AccountError("Message attachments are invalid.");
    }
    const uploadedAttachments = normalizeAttachments(
      input.attachments.filter((item) => item && item.content !== undefined),
    );
    const attachments = uploadedAttachments.map(({ content: _content, ...attachment }) => ({
      ...attachment,
      available: true,
      previewable: PREVIEWABLE_IMAGE_TYPES.has(attachment.type),
    }));
    attachments.unshift(...retainedAttachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      type: attachment.type,
      size: attachment.size,
      available: Boolean(database.attachmentFiles?.[attachment.id]),
      previewable: PREVIEWABLE_IMAGE_TYPES.has(attachment.type),
    })));
    const newMailboxAttachmentSize = attachments.reduce((sum, attachment) => sum + attachment.size, 0);
    for (const mailbox of Object.values(database.mailboxes)) {
      const message = mailbox.messages.find((item) => item.id === messageId);
      if (!message) continue;
      const mailboxStorage = mailbox.messages.reduce(
        (total, item) => total + (item.attachments ?? []).reduce(
          (sum, attachment) => sum + (attachment.size ?? 0),
          0,
        ),
        0,
      );
      const previousStorage = (message.attachments ?? []).reduce(
        (sum, attachment) => sum + (attachment.size ?? 0),
        0,
      );
      if (
        mailboxStorage - previousStorage + newMailboxAttachmentSize >
        MAX_MAILBOX_ATTACHMENT_STORAGE
      ) {
        throw new AccountError("A mailbox has reached its 100 MB attachment storage limit.", 413);
      }
    }
    for (const mailbox of Object.values(database.mailboxes)) {
      const message = mailbox.messages.find((item) => item.id === messageId);
      if (!message) continue;
      message.subject = subject;
      message.preview = bodyText.replace(/\s+/g, " ").slice(0, 130);
      message.body = structuredClone(body);
      message.attachments = structuredClone(attachments);
    }
    database.attachmentFiles ??= {};
    for (const id of previousAttachmentIds) {
      if (!retainedIds.has(id)) delete database.attachmentFiles[id];
    }
    removeUnreferencedAttachmentFiles(database);
    for (const attachment of uploadedAttachments) {
      database.attachmentFiles[attachment.id] = {
        content: attachment.content,
        type: attachment.type,
        size: attachment.size,
        createdAt: new Date().toISOString(),
      };
    }
    if (managed) recordAdminMailAction(database, currentActor, owner, "mail_message_updated");
    return { message: structuredClone({ ...selectedMessage, subject, preview: bodyText.replace(/\s+/g, " ").slice(0, 130), body, attachments }) };
  });
}

export async function deleteManagedMailboxMessage(actor, userId, messageId) {
  return withDatabase((database) => {
    const currentActor = assertCurrentAdmin(database, actor);
    const mailbox = database.mailboxes[userId];
    const owner = database.users.find((user) => user.id === userId);
    const message = mailbox?.messages.find((item) => item.id === messageId);
    if (!owner || !message) throw new AccountError("That message could not be found.", 404);
    const attachmentIds = (message.attachments ?? []).map(({ id }) => id);
    let deletedCopies = 0;
    for (const userMailbox of Object.values(database.mailboxes)) {
      const before = userMailbox.messages.length;
      userMailbox.messages = userMailbox.messages.filter((item) => item.id !== messageId);
      deletedCopies += before - userMailbox.messages.length;
    }
    for (const id of attachmentIds) delete database.attachmentFiles?.[id];
    removeUnreferencedAttachmentFiles(database);
    recordAdminMailAction(database, currentActor, owner, "mail_message_deleted");
    return { deletedCopies };
  });
}

export async function markMailboxMessageRead(userId, messageId) {
  return withDatabase((database) => {
    const user = database.users.find((item) => item.id === userId);
    if (!user) throw new AccountError("Your account could not be found.", 404);
    const mailbox = initializeMailbox(database, user);
    const message = mailbox.messages.find((item) => item.id === messageId);
    if (!message) throw new AccountError("That message could not be found.", 404);
    message.unread = false;
    return { messageId: message.id };
  });
}
