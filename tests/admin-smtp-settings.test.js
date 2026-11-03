import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const temporaryDirectory = await mkdtemp(join(tmpdir(), "beoneofus-smtp-settings-"));
const databasePath = join(temporaryDirectory, "mail-database.json");
process.env.JSON_DATABASE_PATH = databasePath;
process.env.APP_SETTINGS_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const testEmails = [];
const { createApp } = await import("../app.js");
const { promoteAccountToAdmin } = await import("../services/admin.service.js");
const { getSmtpSettingsForDelivery } = await import("../services/smtp-settings.service.js");
let server;
let baseUrl;
const adminEmail = `smtp-admin-${randomUUID()}@beoneofus.com`;
const adminPassword = "smtp-admin-test-password";

before(async () => {
  const { registerAccount } = await import("../services/account.service.js");
  await registerAccount({
    name: "SMTP Admin",
    email: adminEmail,
    password: adminPassword,
  });
  await promoteAccountToAdmin(adminEmail);
  server = createApp({
    smtpTestEmail: async (settings, recipient) => testEmails.push({ settings, recipient }),
  }).listen(0);
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
  await rm(temporaryDirectory, { recursive: true, force: true });
});

async function request(path, { method = "GET", body, cookie, origin } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  if (method !== "GET") headers.Origin = origin ?? baseUrl;
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

function loginCookie(response) {
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  assert.match(cookie, /HttpOnly/i);
  return cookie.split(";")[0];
}

test("admin SMTP settings are authorized, encrypted, and support a test email", async () => {
  assert.equal((await request("/api/admin/settings/smtp")).response.status, 401);

  const login = await request("/api/auth/login", {
    method: "POST",
    body: { email: adminEmail, password: adminPassword },
  });
  assert.equal(login.response.status, 200);
  const cookie = loginCookie(login.response);

  const initial = await request("/api/admin/settings/smtp", { cookie });
  assert.equal(initial.response.status, 200);
  assert.equal(initial.payload.settings.configured, false);
  assert.equal(initial.payload.settings.encryptionKeyConfigured, true);
  assert.equal(Object.hasOwn(initial.payload.settings, "password"), false);

  const baseSettings = {
    host: "smtp.example.test",
    port: "587",
    secure: false,
    from: "mail@beoneofus.com",
    username: "smtp-user",
    password: "smtp-secret-never-return-this",
    passwordConfirmation: adminPassword,
  };
  const badOrigin = await request("/api/admin/settings/smtp", {
    method: "PUT",
    body: baseSettings,
    cookie,
    origin: "https://attacker.invalid",
  });
  assert.equal(badOrigin.response.status, 403);

  const invalid = await request("/api/admin/settings/smtp", {
    method: "PUT",
    body: { ...baseSettings, host: "bad host" },
    cookie,
  });
  assert.equal(invalid.response.status, 400);
  assert.match(invalid.payload.error, /valid SMTP hostname/);

  const unauthorizedChange = await request("/api/admin/settings/smtp", {
    method: "PUT",
    body: { ...baseSettings, passwordConfirmation: "incorrect-admin-password" },
    cookie,
  });
  assert.equal(unauthorizedChange.response.status, 403);

  const sentTest = await request("/api/admin/settings/smtp/test", {
    method: "POST",
    body: baseSettings,
    cookie,
  });
  assert.equal(sentTest.response.status, 200);
  assert.equal(testEmails.length, 1);
  assert.equal(testEmails[0].recipient, adminEmail);
  assert.equal(testEmails[0].settings.password, baseSettings.password);

  const saved = await request("/api/admin/settings/smtp", {
    method: "PUT",
    body: baseSettings,
    cookie,
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.payload.settings.source, "admin");
  assert.equal(saved.payload.settings.passwordConfigured, true);
  assert.equal(Object.hasOwn(saved.payload.settings, "password"), false);
  assert.equal(JSON.stringify(saved.payload).includes(baseSettings.password), false);
  const deliverySettings = await getSmtpSettingsForDelivery();
  assert.equal(deliverySettings.password, baseSettings.password);
  assert.equal(deliverySettings.host, baseSettings.host);

  const database = JSON.parse(await readFile(databasePath, "utf8"));
  const savedSettings = database.settings.smtp;
  assert.ok(savedSettings.passwordEncrypted.ciphertext);
  assert.equal(JSON.stringify(savedSettings).includes(baseSettings.password), false);
  assert.equal(database.adminAuditLog.at(-1).action, "smtp_settings_updated");

  const preservedPassword = await request("/api/admin/settings/smtp/test", {
    method: "POST",
    body: { ...baseSettings, password: "" },
    cookie,
  });
  assert.equal(preservedPassword.response.status, 200);
  assert.equal(testEmails.at(-1).settings.password, baseSettings.password);

  const clearedAuth = await request("/api/admin/settings/smtp", {
    method: "PUT",
    body: {
      ...baseSettings,
      username: "",
      password: "",
    },
    cookie,
  });
  assert.equal(clearedAuth.response.status, 200);
  assert.equal(clearedAuth.payload.settings.passwordConfigured, false);
});
