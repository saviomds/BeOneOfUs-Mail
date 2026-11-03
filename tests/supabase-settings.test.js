import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const temporaryDirectory = await mkdtemp(join(tmpdir(), "beoneofus-supabase-settings-"));
const databasePath = join(temporaryDirectory, "mail-database.json");
process.env.JSON_DATABASE_PATH = databasePath;
process.env.APP_SETTINGS_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const testedConnections = [];
const { createApp } = await import("../app.js");
const { promoteAccountToAdmin } = await import("../services/admin.service.js");
let server;
let baseUrl;
const adminEmail = `database-admin-${randomUUID()}@beoneofus.com`;
const adminPassword = "database-admin-test-password";

before(async () => {
  const { registerAccount } = await import("../services/account.service.js");
  await registerAccount({
    name: "Database Admin",
    email: adminEmail,
    password: adminPassword,
  });
  await promoteAccountToAdmin(adminEmail);
  server = createApp({
    supabaseConnectionTest: async (settings) => testedConnections.push(settings),
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
  return cookie.split(";")[0];
}

test("Supabase settings remain future-only, encrypted, and project-host constrained", async () => {
  assert.equal((await request("/api/admin/settings/database/supabase")).response.status, 401);
  const login = await request("/api/auth/login", {
    method: "POST",
    body: { email: adminEmail, password: adminPassword },
  });
  const cookie = loginCookie(login.response);

  const initial = await request("/api/admin/settings/database/supabase", { cookie });
  assert.equal(initial.response.status, 200);
  assert.equal(initial.payload.settings.activeDatabase, "json");
  assert.equal(initial.payload.settings.active, false);
  assert.equal(initial.payload.settings.configured, false);
  assert.equal(Object.hasOwn(initial.payload.settings, "apiKey"), false);

  const settings = {
    projectUrl: "https://e2e-project.supabase.co",
    apiKey: "supabase-test-key-never-store-plaintext",
    passwordConfirmation: adminPassword,
  };
  const unsafeUrl = await request("/api/admin/settings/database/supabase/test", {
    method: "POST",
    body: { ...settings, projectUrl: "http://127.0.0.1" },
    cookie,
  });
  assert.equal(unsafeUrl.response.status, 400);
  assert.match(unsafeUrl.payload.error, /HTTPS Supabase project URL/);

  const unsafeHost = await request("/api/admin/settings/database/supabase/test", {
    method: "POST",
    body: { ...settings, projectUrl: "https://attacker.example" },
    cookie,
  });
  assert.equal(unsafeHost.response.status, 400);

  const badOrigin = await request("/api/admin/settings/database/supabase", {
    method: "PUT",
    body: settings,
    cookie,
    origin: "https://attacker.invalid",
  });
  assert.equal(badOrigin.response.status, 403);

  const incorrectPassword = await request("/api/admin/settings/database/supabase/test", {
    method: "POST",
    body: { ...settings, passwordConfirmation: "incorrect-admin-password" },
    cookie,
  });
  assert.equal(incorrectPassword.response.status, 403);

  const connectionTest = await request("/api/admin/settings/database/supabase/test", {
    method: "POST",
    body: settings,
    cookie,
  });
  assert.equal(connectionTest.response.status, 200);
  assert.equal(testedConnections[0].projectUrl, settings.projectUrl);
  assert.equal(testedConnections[0].apiKey, settings.apiKey);
  assert.match(connectionTest.payload.message, /JSON remains the active database/);

  const saved = await request("/api/admin/settings/database/supabase", {
    method: "PUT",
    body: settings,
    cookie,
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.payload.settings.activeDatabase, "json");
  assert.equal(saved.payload.settings.active, false);
  assert.equal(saved.payload.settings.configured, true);
  assert.equal(saved.payload.settings.apiKeyConfigured, true);
  assert.equal(Object.hasOwn(saved.payload.settings, "apiKey"), false);
  assert.equal(JSON.stringify(saved.payload).includes(settings.apiKey), false);

  const savedDatabase = JSON.parse(await readFile(databasePath, "utf8"));
  const stored = savedDatabase.settings.supabase;
  assert.ok(stored.apiKeyEncrypted.ciphertext);
  assert.equal(JSON.stringify(stored).includes(settings.apiKey), false);
  assert.equal(savedDatabase.adminAuditLog.at(-1).action, "database_settings_updated");

  const testWithSavedKey = await request("/api/admin/settings/database/supabase/test", {
    method: "POST",
    body: {
      projectUrl: settings.projectUrl,
      apiKey: "",
      passwordConfirmation: adminPassword,
    },
    cookie,
  });
  assert.equal(testWithSavedKey.response.status, 200);
  assert.equal(testedConnections.at(-1).apiKey, settings.apiKey);
});
