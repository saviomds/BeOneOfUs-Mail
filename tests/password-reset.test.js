import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const temporaryDirectory = await mkdtemp(join(tmpdir(), "beoneofus-password-reset-"));
const databasePath = join(temporaryDirectory, "mail-database.json");
process.env.JSON_DATABASE_PATH = databasePath;
process.env.APP_BASE_URL = "https://mail.example.test";

const deliveredEmails = [];
const { createApp } = await import("../app.js");
let server;
let baseUrl;

before(async () => {
  server = createApp({
    passwordResetMailer: async (message) => deliveredEmails.push(message),
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

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    response,
    payload: response.headers.get("content-type")?.includes("application/json")
      ? await response.json()
      : null,
  };
}

test("password reset email links are private, expiring, one-time, and rate limited", async () => {
  const email = `reset-${randomUUID()}@beoneofus.com`;
  const originalPassword = "original-test-password";
  const registration = await post("/api/auth/register", {
    name: "Reset Test",
    email,
    password: originalPassword,
  });
  assert.equal(registration.response.status, 202);

  const requested = await post("/api/auth/password-reset/request", { email });
  assert.equal(requested.response.status, 202);
  assert.match(requested.payload.message, /If an account exists/);
  assert.equal(deliveredEmails.length, 1);
  const resetUrl = new URL(deliveredEmails[0].url);
  assert.equal(resetUrl.pathname, "/reset-password");
  assert.equal(resetUrl.search, "");
  assert.equal(resetUrl.href.includes(email), false);
  const token = new URLSearchParams(resetUrl.hash.slice(1)).get("token");
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);

  const savedDatabase = JSON.parse(await readFile(databasePath, "utf8"));
  const savedUser = savedDatabase.users.find((user) => user.email === email);
  assert.equal(savedUser.passwordResetTokenHash.length, 64);
  assert.equal(JSON.stringify(savedDatabase).includes(token), false);

  const newPassword = "new-test-password";
  assert.equal((await post("/api/auth/password-reset/confirm", {
    token,
    password: newPassword,
  })).response.status, 200);
  assert.equal((await post("/api/auth/password-reset/confirm", {
    token,
    password: "another-new-password",
  })).response.status, 400);
  assert.equal((await post("/api/auth/login", {
    email,
    password: originalPassword,
  })).response.status, 401);
  assert.equal((await post("/api/auth/login", {
    email,
    password: newPassword,
  })).response.status, 403, "a valid new password still respects pending approval");

  const unknown = `unknown-${randomUUID()}@beoneofus.com`;
  const unknownRequest = await post("/api/auth/password-reset/request", { email: unknown });
  assert.equal(unknownRequest.response.status, 202);
  assert.equal(unknownRequest.payload.message, requested.payload.message);
  assert.equal(deliveredEmails.length, 1);

  await post("/api/auth/password-reset/request", { email });
  const expiredToken = new URLSearchParams(
    new URL(deliveredEmails.at(-1).url).hash.slice(1),
  ).get("token");
  const database = JSON.parse(await readFile(databasePath, "utf8"));
  const user = database.users.find((item) => item.email === email);
  user.passwordResetExpiresAt = new Date(Date.now() - 1000).toISOString();
  await writeFile(databasePath, `${JSON.stringify(database, null, 2)}\n`, "utf8");
  assert.equal((await post("/api/auth/password-reset/confirm", {
    token: expiredToken,
    password: "expired-link-password",
  })).response.status, 400);

  const limitedEmail = `limited-${randomUUID()}@beoneofus.com`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.equal((await post("/api/auth/password-reset/request", {
      email: limitedEmail,
    })).response.status, 202);
  }
  const limited = await post("/api/auth/password-reset/request", { email: limitedEmail });
  assert.equal(limited.response.status, 429);
  assert.ok(Number(limited.response.headers.get("retry-after")) > 0);
});
