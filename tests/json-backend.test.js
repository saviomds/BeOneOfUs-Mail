import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const temporaryDirectory = await mkdtemp(join(tmpdir(), "beoneofus-json-db-"));
const databaseFile = join(temporaryDirectory, "mail-database.json");
process.env.JSON_DATABASE_PATH = databaseFile;

const { createApp } = await import("../app.js");
const { promoteAccountToAdmin } = await import("../services/admin.service.js");
let server;
let baseUrl;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(temporaryDirectory, { recursive: true, force: true });
});

async function request(path, { method = "GET", body, cookie, origin } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  if (method !== "GET" && origin !== null) headers.Origin = origin ?? baseUrl;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const payload = response.headers.get("content-type")?.includes("application/json")
    ? await response.json()
    : null;
  return { response, payload };
}

function sessionCookie(response) {
  const value = response.headers.get("set-cookie");
  assert.ok(value, "auth response should set an HttpOnly session cookie");
  assert.match(value, /HttpOnly/i);
  return value.split(";")[0];
}

test("company access requires approval and admin controls are role-protected", async () => {
  assert.equal((await request("/api/mailbox")).response.status, 401);
  assert.equal((await request("/api/admin/overview")).response.status, 401);

  const password = "temporary-test-password";
  const outsider = await request("/api/auth/register", {
    method: "POST",
    body: { name: "Outside User", email: `outside-${randomUUID()}@example.com`, password },
  });
  assert.equal(outsider.response.status, 400);

  const memberEmail = `qa-${randomUUID()}@beoneofus.com`;
  const registration = await request("/api/auth/register", {
    method: "POST",
    body: { name: "QA Member", email: memberEmail, password },
  });
  assert.equal(registration.response.status, 202);
  assert.equal(registration.payload.user.status, "pending");
  assert.equal(registration.payload.user.role, "member");
  assert.equal(registration.response.headers.get("set-cookie"), null);
  assert.equal(JSON.stringify(registration.payload).includes(password), false);
  assert.equal((await request("/api/auth/login", {
    method: "POST",
    body: { email: memberEmail, password },
  })).response.status, 403);

  const adminEmail = `admin-${randomUUID()}@beoneofus.com`;
  const adminRegistration = await request("/api/auth/register", {
    method: "POST",
    body: { name: "QA Admin", email: adminEmail, password },
  });
  assert.equal(adminRegistration.response.status, 202);
  await promoteAccountToAdmin(adminEmail);
  const adminLogin = await request("/api/auth/login", {
    method: "POST",
    body: { email: adminEmail, password },
  });
  assert.equal(adminLogin.response.status, 200);
  const adminCookie = sessionCookie(adminLogin.response);
  assert.equal(adminLogin.payload.user.role, "admin");

  const adminPage = await request("/admin", { cookie: adminCookie });
  assert.equal(adminPage.response.status, 200);
  assert.match(await adminPage.response.text(), /Admin dashboard/);
  assert.equal(adminPage.response.headers.get("cache-control"), "no-store");
  assert.equal(adminPage.response.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"), true);
  assert.equal(adminPage.response.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await request("/admin.html", { cookie: adminCookie })).response.status, 404);

  const overview = await request("/api/admin/overview", { cookie: adminCookie });
  assert.equal(overview.response.headers.get("cache-control"), "no-store");
  assert.equal(overview.payload.stats.pending, 1);
  assert.equal(overview.payload.notifications.length, 1);
  assert.equal(overview.payload.notifications.some((item) => item.userId === adminLogin.payload.user.id), false);
  assert.equal(JSON.stringify(overview.payload).includes("Community meetup this Friday"), false);
  const member = overview.payload.users.find((user) => user.email === memberEmail);
  assert.ok(member);
  assert.equal(member.status, "pending");

  const missingOrigin = await request(`/api/admin/users/${encodeURIComponent(member.id)}/status`, {
    method: "PATCH",
    body: { status: "approved", password },
    cookie: adminCookie,
    origin: null,
  });
  assert.equal(missingOrigin.response.status, 403);
  const crossOrigin = await request(`/api/admin/users/${encodeURIComponent(member.id)}/status`, {
    method: "PATCH",
    body: { status: "approved", password },
    cookie: adminCookie,
    origin: "https://attacker.invalid",
  });
  assert.equal(crossOrigin.response.status, 403);
  const missingPassword = await request(`/api/admin/users/${encodeURIComponent(member.id)}/status`, {
    method: "PATCH",
    body: { status: "approved" },
    cookie: adminCookie,
  });
  assert.equal(missingPassword.response.status, 403);
  const wrongPassword = await request(`/api/admin/users/${encodeURIComponent(member.id)}/status`, {
    method: "PATCH",
    body: { status: "approved", password: "incorrect-password" },
    cookie: adminCookie,
  });
  assert.equal(wrongPassword.response.status, 403);

  const approve = await request(`/api/admin/users/${encodeURIComponent(member.id)}/status`, {
    method: "PATCH",
    body: { status: "approved", password },
    cookie: adminCookie,
  });
  assert.equal(approve.response.status, 200);
  assert.equal(approve.payload.user.status, "approved");

  const memberLogin = await request("/api/auth/login", {
    method: "POST",
    body: { email: memberEmail, password },
  });
  assert.equal(memberLogin.response.status, 200);
  const memberCookie = sessionCookie(memberLogin.response);
  assert.equal(memberLogin.payload.user.role, "member");
  assert.equal((await request("/admin", { cookie: memberCookie })).response.status, 302);
  assert.equal((await request("/api/admin/overview", { cookie: memberCookie })).response.status, 403);

  const notifications = await request("/api/users/me/notifications", { cookie: memberCookie });
  assert.equal(notifications.payload.notifications[0].unread, true);
  assert.match(notifications.payload.notifications[0].message, /approved/);
  assert.equal((await request("/api/users/me/notifications", { cookie: memberCookie }))
    .payload.notifications[0].unread, false);

  const initialMailbox = await request("/api/mailbox", { cookie: memberCookie });
  assert.equal(initialMailbox.payload.mailbox.messages.length, 5);
  assert.ok(initialMailbox.payload.mailbox.messages.some(
    (message) => message.senderEmail === "admin@beoneofus.com",
  ));

  const databaseBeforeLegacyMailboxSend = JSON.parse(await readFile(databaseFile, "utf8"));
  delete databaseBeforeLegacyMailboxSend.mailboxes[member.id];
  delete databaseBeforeLegacyMailboxSend.mailboxes[adminLogin.payload.user.id];
  await writeFile(databaseFile, JSON.stringify(databaseBeforeLegacyMailboxSend));

  const adminSentMessage = await request("/api/mailbox/send", {
    method: "POST",
    body: {
      message: {
        recipientEmail: memberEmail,
        subject: "Admin welcome",
        body: "Welcome to the team.",
        attachments: [{
          name: "welcome.txt",
          type: "text/plain",
          size: Buffer.byteLength("Welcome attachment"),
          content: Buffer.from("Welcome attachment").toString("base64"),
        }],
      },
    },
    cookie: adminCookie,
  });
  assert.equal(adminSentMessage.response.status, 201);
  const deliveredToMember = await request("/api/mailbox", { cookie: memberCookie });
  const receivedWelcome = deliveredToMember.payload.mailbox.messages.find(
    (message) => message.id === adminSentMessage.payload.message.id,
  );
  assert.equal(receivedWelcome.folder, "inbox");
  assert.equal(receivedWelcome.unread, true);
  assert.equal(receivedWelcome.senderEmail, adminEmail);
  assert.equal(receivedWelcome.attachments[0].available, true);
  const memberAttachment = await request(
    `/api/mailbox/messages/${encodeURIComponent(receivedWelcome.id)}/attachments/${encodeURIComponent(receivedWelcome.attachments[0].id)}`,
    { cookie: memberCookie },
  );
  assert.equal(memberAttachment.response.status, 200);
  assert.equal(Buffer.from(await memberAttachment.response.arrayBuffer()).toString(), "Welcome attachment");
  assert.equal((await request(`/api/admin/users/${encodeURIComponent(member.id)}/mailbox`, {
    cookie: memberCookie,
  })).response.status, 403);
  const managedMemberMailbox = await request(
    `/api/admin/users/${encodeURIComponent(member.id)}/mailbox`,
    { cookie: adminCookie },
  );
  assert.equal(managedMemberMailbox.response.status, 200);
  assert.ok(managedMemberMailbox.payload.mailbox.messages.some(
    (message) => message.id === receivedWelcome.id,
  ));
  const managedAttachment = await request(
    `/api/admin/users/${encodeURIComponent(member.id)}/mailbox/messages/${encodeURIComponent(receivedWelcome.id)}/attachments/${encodeURIComponent(receivedWelcome.attachments[0].id)}`,
    { cookie: adminCookie },
  );
  assert.equal(managedAttachment.response.status, 200);
  assert.equal(Buffer.from(await managedAttachment.response.arrayBuffer()).toString(), "Welcome attachment");

  const memberReply = await request("/api/mailbox/send", {
    method: "POST",
    body: {
      message: {
        recipientEmail: adminEmail,
        subject: "Re: Admin welcome",
        body: "Thanks!",
        attachments: [{
          name: "reply.txt",
          type: "text/plain",
          size: Buffer.byteLength("A reply attachment"),
          content: Buffer.from("A reply attachment").toString("base64"),
        }],
      },
    },
    cookie: memberCookie,
  });
  assert.equal(memberReply.response.status, 201);
  const memberEditedMessage = await request(
    `/api/mailbox/messages/${encodeURIComponent(memberReply.payload.message.id)}`,
    {
      method: "PATCH",
      body: {
        message: {
          subject: "Member-edited reply",
          body: "Updated by the member.",
          attachments: memberReply.payload.message.attachments.map(
            ({ id, name, type, size }) => ({ id, name, type, size }),
          ),
        },
      },
      cookie: memberCookie,
    },
  );
  assert.equal(memberEditedMessage.response.status, 200);
  assert.equal(memberEditedMessage.payload.message.subject, "Member-edited reply");
  assert.equal((await request("/api/mailbox", { cookie: adminCookie }))
    .payload.mailbox.messages.find((message) => message.id === memberReply.payload.message.id)
    .subject, "Member-edited reply");
  assert.equal((await request(
    `/api/mailbox/messages/${encodeURIComponent(receivedWelcome.id)}`,
    {
      method: "PATCH",
      body: { message: { subject: "Unauthorized edit", body: "No.", attachments: [] } },
      cookie: memberCookie,
    },
  )).response.status, 403);
  const spoofedMailbox = (await request("/api/mailbox", { cookie: memberCookie }))
    .payload.mailbox;
  const spoofedReceivedMessage = spoofedMailbox.messages.find(
    (message) => message.id === receivedWelcome.id,
  );
  Object.assign(spoofedReceivedMessage, {
    folder: "sent",
    senderEmail: memberEmail,
    recipientEmail: adminEmail,
  });
  assert.equal((await request("/api/mailbox", {
    method: "PUT",
    body: { mailbox: spoofedMailbox },
    cookie: memberCookie,
  })).response.status, 200);
  assert.equal((await request(
    `/api/mailbox/messages/${encodeURIComponent(receivedWelcome.id)}`,
    {
      method: "PATCH",
      body: { message: { subject: "Spoofed edit", body: "No.", attachments: [] } },
      cookie: memberCookie,
    },
  )).response.status, 403);
  Object.assign(spoofedReceivedMessage, receivedWelcome);
  assert.equal((await request("/api/mailbox", {
    method: "PUT",
    body: { mailbox: spoofedMailbox },
    cookie: memberCookie,
  })).response.status, 200);
  const deliveredToAdmin = await request("/api/mailbox", { cookie: adminCookie });
  const receivedReply = deliveredToAdmin.payload.mailbox.messages.find(
    (message) => message.id === memberReply.payload.message.id,
  );
  assert.equal(receivedReply.folder, "inbox");
  assert.equal(receivedReply.unread, true);
  const markedRead = await request(
    `/api/mailbox/messages/${encodeURIComponent(receivedReply.id)}/read`,
    { method: "PATCH", body: {}, cookie: adminCookie },
  );
  assert.equal(markedRead.response.status, 200);
  assert.equal((await request("/api/mailbox", { cookie: adminCookie }))
    .payload.mailbox.messages.find((message) => message.id === receivedReply.id).unread, false);

  const updatedAdminManagedMessage = await request(
    `/api/admin/users/${encodeURIComponent(adminLogin.payload.user.id)}/mailbox/messages/${encodeURIComponent(receivedReply.id)}`,
    {
      method: "PATCH",
      body: {
        message: {
          subject: "Admin-edited reply",
          body: "Updated by an administrator.",
          attachments: [{
            id: receivedReply.attachments[0].id,
            name: receivedReply.attachments[0].name,
            type: receivedReply.attachments[0].type,
            size: receivedReply.attachments[0].size,
          }, {
            name: "admin-added.txt",
            type: "text/plain",
            size: Buffer.byteLength("Added by admin"),
            content: Buffer.from("Added by admin").toString("base64"),
          }],
        },
      },
      cookie: adminCookie,
    },
  );
  assert.equal(updatedAdminManagedMessage.response.status, 200);
  const editedMemberSent = await request("/api/mailbox", { cookie: memberCookie });
  const editedSentCopy = editedMemberSent.payload.mailbox.messages.find(
    (message) => message.id === receivedReply.id,
  );
  assert.equal(editedSentCopy.subject, "Admin-edited reply");
  assert.equal(editedSentCopy.body[0], "Updated by an administrator.");
  assert.equal(editedSentCopy.attachments.length, 2);

  const deletedAdminManagedMessage = await request(
    `/api/admin/users/${encodeURIComponent(member.id)}/mailbox/messages/${encodeURIComponent(receivedReply.id)}`,
    { method: "DELETE", body: {}, cookie: adminCookie },
  );
  assert.equal(deletedAdminManagedMessage.response.status, 200);
  assert.equal((await request("/api/mailbox", { cookie: memberCookie }))
    .payload.mailbox.messages.some((message) => message.id === receivedReply.id), false);
  assert.equal((await request("/api/mailbox", { cookie: adminCookie }))
    .payload.mailbox.messages.some((message) => message.id === receivedReply.id), false);
  const mailAudit = await request("/api/admin/overview", { cookie: adminCookie });
  assert.ok(mailAudit.payload.auditLog.some((entry) => entry.action === "mail_message_sent"));
  assert.ok(mailAudit.payload.auditLog.some((entry) => entry.action === "mail_message_updated"));
  assert.ok(mailAudit.payload.auditLog.some((entry) => entry.action === "mail_message_deleted"));

  assert.equal((await request("/api/mailbox/send", {
    method: "POST",
    body: { message: { recipientEmail: "outside@example.com", subject: "No", body: "No" } },
    cookie: adminCookie,
  })).response.status, 400);
  assert.equal((await request("/api/mailbox/send", {
    method: "POST",
    body: { message: { recipientEmail: memberEmail, subject: "No", body: "No" } },
    cookie: adminCookie,
    origin: "https://attacker.invalid",
  })).response.status, 403);

  const updatedProfile = await request("/api/users/me", {
    method: "PUT",
    body: {
      name: "Updated Member",
      email: memberEmail,
      bio: "Internal team member.",
      position: "Operations Coordinator",
      phone: "+1 (555) 010-1234",
      location: "Chicago, USA",
      profilePhoto: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==",
      avatarSticker: "sparkle",
    },
    cookie: memberCookie,
  });
  assert.equal(updatedProfile.response.status, 200);
  assert.equal(updatedProfile.payload.user.name, "Updated Member");
  assert.equal(updatedProfile.payload.user.position, "Operations Coordinator");
  assert.equal(updatedProfile.payload.user.phone, "+1 (555) 010-1234");
  assert.equal(updatedProfile.payload.user.location, "Chicago, USA");
  assert.equal(updatedProfile.payload.user.profilePhoto, "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==");
  assert.equal(updatedProfile.payload.user.avatarSticker, "sparkle");
  const memberProfile = await request("/api/auth/me", { cookie: memberCookie });
  assert.equal(memberProfile.payload.user.bio, "Internal team member.");
  assert.equal(memberProfile.payload.user.position, "Operations Coordinator");
  assert.equal(memberProfile.payload.user.profilePhoto, updatedProfile.payload.user.profilePhoto);
  assert.equal(memberProfile.payload.user.avatarSticker, "sparkle");
  assert.equal((await request(`/api/admin/users/${encodeURIComponent(member.id)}/profile`, {
    cookie: memberCookie,
  })).response.status, 403);
  const adminMemberProfile = await request(`/api/admin/users/${encodeURIComponent(member.id)}/profile`, {
    cookie: adminCookie,
  });
  assert.equal(adminMemberProfile.response.status, 200);
  assert.equal(adminMemberProfile.payload.user.phone, "+1 (555) 010-1234");
  assert.equal(adminMemberProfile.payload.user.position, "Operations Coordinator");
  assert.equal(adminMemberProfile.payload.user.profilePhoto, updatedProfile.payload.user.profilePhoto);
  assert.equal((await request(`/api/admin/users/${encodeURIComponent(member.id)}/profile`, {
    method: "PATCH",
    body: {
      name: "Admin Edited Member",
      email: memberEmail,
      position: "Team Lead",
      phone: "+1 555 010 9988",
      location: "Denver, USA",
      bio: "Updated by an administrator.",
    },
    cookie: adminCookie,
    origin: null,
  })).response.status, 403);
  const incorrectProfilePassword = await request(
    `/api/admin/users/${encodeURIComponent(member.id)}/profile`,
    {
      method: "PATCH",
      body: {
        name: "Admin Edited Member",
        email: memberEmail,
        password: "incorrect-password",
      },
      cookie: adminCookie,
    },
  );
  assert.equal(incorrectProfilePassword.response.status, 403);
  const managedProfileUpdate = await request(
    `/api/admin/users/${encodeURIComponent(member.id)}/profile`,
    {
      method: "PATCH",
      body: {
        name: "Admin Edited Member",
        email: memberEmail,
        position: "Team Lead",
        phone: "+1 555 010 9988",
        location: "Denver, USA",
        bio: "Updated by an administrator.",
        avatarSticker: "orbit",
        password,
      },
      cookie: adminCookie,
    },
  );
  assert.equal(managedProfileUpdate.response.status, 200);
  assert.equal(managedProfileUpdate.payload.user.name, "Admin Edited Member");
  assert.equal(managedProfileUpdate.payload.user.position, "Team Lead");
  assert.ok(managedProfileUpdate.payload.user.createdAt);
  assert.equal(managedProfileUpdate.payload.user.phone, "+1 555 010 9988");
  assert.equal(managedProfileUpdate.payload.user.avatarSticker, "orbit");
  assert.equal(
    managedProfileUpdate.payload.user.profilePhoto,
    updatedProfile.payload.user.profilePhoto,
    "admin profile edits preserve the employee's profile photo",
  );
  assert.equal((await request(`/api/admin/users/${encodeURIComponent(member.id)}/profile`, {
    method: "PATCH",
    body: {
      name: "Unauthorized Edit",
      email: memberEmail,
      password,
    },
    cookie: memberCookie,
  })).response.status, 403);
  const selfAdminProfileUpdate = await request(
    `/api/admin/users/${encodeURIComponent(adminLogin.payload.user.id)}/profile`,
    {
      method: "PATCH",
      body: {
        name: "QA Admin Profile",
        email: adminEmail,
        position: "Mail Administrator",
        phone: "+1 555 010 2222",
        location: "Company HQ",
        bio: "Administrator profile.",
        password,
      },
      cookie: adminCookie,
    },
  );
  assert.equal(selfAdminProfileUpdate.response.status, 200);
  assert.equal(selfAdminProfileUpdate.payload.user.role, "admin");
  assert.equal(selfAdminProfileUpdate.payload.user.status, "approved");
  assert.equal(selfAdminProfileUpdate.payload.user.position, "Mail Administrator");
  const directoryEntry = (await request("/api/admin/overview", { cookie: adminCookie }))
    .payload.users.find((user) => user.id === member.id);
  assert.equal(directoryEntry.name, "Admin Edited Member");
  assert.equal(directoryEntry.position, "Team Lead");
  assert.equal(directoryEntry.avatarSticker, "orbit");
  assert.equal(Object.hasOwn(directoryEntry, "phone"), false);
  assert.equal(
    directoryEntry.profilePhoto,
    updatedProfile.payload.user.profilePhoto,
    "admin directory includes the photo for the employee avatar",
  );

  assert.equal((await request("/api/users/me", {
    method: "PUT",
    body: { name: "Updated Member", email: memberEmail, phone: "not a phone" },
    cookie: memberCookie,
  })).response.status, 400);
  assert.equal((await request("/api/users/me", {
    method: "PUT",
    body: {
      name: "Updated Member",
      email: memberEmail,
      profilePhoto: "data:image/png;base64,invalid",
    },
    cookie: memberCookie,
  })).response.status, 400);
  assert.equal((await request("/api/users/me", {
    method: "PUT",
    body: {
      name: "Updated Member",
      email: memberEmail,
      avatarSticker: "<script>",
    },
    cookie: memberCookie,
  })).response.status, 400);
  const removedProfilePhoto = await request("/api/users/me", {
    method: "PUT",
    body: {
      name: "Updated Member",
      email: memberEmail,
      bio: "Internal team member.",
      position: "Operations Coordinator",
      phone: "+1 (555) 010-1234",
      location: "Chicago, USA",
      profilePhoto: "",
    },
    cookie: memberCookie,
  });
  assert.equal(removedProfilePhoto.response.status, 200);
  assert.equal(removedProfilePhoto.payload.user.profilePhoto, "");

  const mailbox = {
    messages: [{
      id: "server-message",
      sender: "QA Member",
      senderEmail: memberEmail,
      recipientEmail: adminEmail,
      subject: "Persisted subject",
      preview: "Persisted body",
      body: ["Persisted body"],
      attachments: [],
      color: "lilac",
      category: "primary",
      labels: ["QA"],
      unread: false,
      starred: true,
      folder: "sent",
      createdAt: new Date().toISOString(),
      reactions: [],
    }],
    drafts: [],
    labels: [{ name: "QA", color: "lilac" }],
  };
  const savedMailbox = await request("/api/mailbox", {
    method: "PUT",
    body: { mailbox },
    cookie: memberCookie,
  });
  assert.equal(savedMailbox.response.status, 200);
  assert.equal((await request("/api/mailbox", { cookie: memberCookie }))
    .payload.mailbox.messages[0].subject, "Persisted subject");

  assert.equal((await request("/api/mailbox", {
    method: "PUT",
    body: { mailbox: { messages: "not-an-array", drafts: [], labels: [] } },
    cookie: memberCookie,
  })).response.status, 400);

  const externalAddressMailbox = structuredClone(mailbox);
  externalAddressMailbox.messages[0].recipientEmail = "someone@example.com";
  assert.equal((await request("/api/mailbox", {
    method: "PUT",
    body: { mailbox: externalAddressMailbox },
    cookie: memberCookie,
  })).response.status, 400);

  const externalProfileEmail = await request("/api/users/me", {
    method: "PUT",
    body: { name: "QA Member", email: "member@example.com", bio: "" },
    cookie: memberCookie,
  });
  assert.equal(externalProfileEmail.response.status, 400);

  const suspend = await request(`/api/admin/users/${encodeURIComponent(member.id)}/status`, {
    method: "PATCH",
    body: { status: "suspended", password },
    cookie: adminCookie,
  });
  assert.equal(suspend.response.status, 400);
  const missingReason = await request(`/api/admin/users/${encodeURIComponent(member.id)}/status`, {
    method: "PATCH",
    body: { status: "suspended", password, reason: "   " },
    cookie: adminCookie,
  });
  assert.equal(missingReason.response.status, 400);
  const confirmedSuspend = await request(`/api/admin/users/${encodeURIComponent(member.id)}/status`, {
    method: "PATCH",
    body: { status: "suspended", password, reason: "Employment ended." },
    cookie: adminCookie,
  });
  assert.equal(confirmedSuspend.response.status, 200);
  assert.equal((await request("/api/mailbox", { cookie: memberCookie })).response.status, 401);
  assert.equal((await request("/api/auth/login", {
    method: "POST",
    body: { email: memberEmail, password },
  })).response.status, 403);

  assert.equal((await request(`/api/admin/users/${encodeURIComponent(adminLogin.payload.user.id)}/status`, {
    method: "PATCH",
    body: { status: "suspended", password, reason: "Test protected admin." },
    cookie: adminCookie,
  })).response.status, 403);

  const restore = await request(`/api/admin/users/${encodeURIComponent(member.id)}/status`, {
    method: "PATCH",
    body: { status: "approved", password },
    cookie: adminCookie,
  });
  assert.equal(restore.response.status, 200);
  const restoredLogin = await request("/api/auth/login", {
    method: "POST",
    body: { email: memberEmail, password },
  });
  assert.equal(restoredLogin.response.status, 200);
  const restoredCookie = sessionCookie(restoredLogin.response);
  assert.equal((await request("/api/auth/logout", {
    method: "POST",
    cookie: restoredCookie,
  })).response.status, 200);
  assert.equal((await request("/api/mailbox", { cookie: restoredCookie })).response.status, 401);

  const duplicate = await request("/api/auth/register", {
    method: "POST",
    body: { name: "Duplicate", email: memberEmail.toUpperCase(), password },
  });
  assert.equal(duplicate.response.status, 409);

  const isolatedEmail = `isolated-${randomUUID()}@beoneofus.com`;
  const isolatedRegistration = await request("/api/auth/register", {
    method: "POST",
    body: { name: "Isolated Member", email: isolatedEmail, password },
  });
  assert.equal(isolatedRegistration.response.status, 202);
  const refreshedOverview = await request("/api/admin/overview", { cookie: adminCookie });
  const isolatedAccount = refreshedOverview.payload.users.find((user) => user.email === isolatedEmail);
  assert.ok(isolatedAccount);
  assert.equal((await request(`/api/admin/users/${encodeURIComponent(isolatedAccount.id)}/status`, {
    method: "PATCH",
    body: { status: "approved", password },
    cookie: adminCookie,
  })).response.status, 200);
  const isolatedLogin = await request("/api/auth/login", {
    method: "POST",
    body: { email: isolatedEmail, password },
  });
  assert.equal(isolatedLogin.response.status, 200);
  const isolatedMailbox = await request("/api/mailbox", { cookie: sessionCookie(isolatedLogin.response) });
  assert.equal(isolatedMailbox.payload.mailbox.messages.length, 5);
  assert.notEqual(isolatedMailbox.payload.mailbox.messages[0].id, "server-message");

  const auditedOverview = await request("/api/admin/overview", { cookie: adminCookie });
  assert.ok(auditedOverview.payload.auditLog.some(
    (entry) => entry.targetEmail === memberEmail && entry.status === "suspended" &&
      entry.reason === "Employment ended." && entry.actorEmail === adminEmail,
  ));
  assert.ok(auditedOverview.payload.auditLog.some(
    (entry) => entry.targetEmail === adminEmail && entry.action === "admin_promoted",
  ));
  assert.ok(auditedOverview.payload.auditLog.some(
    (entry) => entry.targetEmail === memberEmail && entry.action === "profile_updated",
  ));
  assert.ok(auditedOverview.payload.auditLog.some(
    (entry) => entry.targetEmail === adminEmail && entry.action === "profile_updated",
  ));

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const failedConfirmation = await request(
      `/api/admin/users/${encodeURIComponent(isolatedAccount.id)}/status`,
      {
        method: "PATCH",
        body: { status: "approved", password: "incorrect-admin-password" },
        cookie: adminCookie,
      },
    );
    assert.equal(failedConfirmation.response.status, 403);
  }
  const lockedConfirmation = await request(
    `/api/admin/users/${encodeURIComponent(isolatedAccount.id)}/status`,
    {
      method: "PATCH",
      body: { status: "approved", password },
      cookie: adminCookie,
    },
  );
  assert.equal(lockedConfirmation.response.status, 429);

  const database = JSON.parse(await readFile(process.env.JSON_DATABASE_PATH, "utf8"));
  const savedUser = database.users.find((user) => user.email === memberEmail);
  assert.equal(savedUser.status, "approved");
  assert.ok(savedUser.passwordSalt);
  assert.notEqual(savedUser.passwordHash, password);
  assert.equal((await readFile(process.env.JSON_DATABASE_PATH, "utf8")).includes(password), false);
  assert.ok(database.adminAuditLog.length >= 4);
  assert.ok(database.adminAuditLog.some((entry) => entry.actorEmail === adminEmail));
});
