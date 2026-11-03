import { createHash, randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { AccountError } from "./errors.js";
import { withDatabase } from "./json-database.service.js";

const scrypt = promisify(scryptCallback);
const PASSWORD_KEY_LENGTH = 64;
const RESET_TOKEN_LIFETIME_MS = 30 * 60 * 1000;

function tokenDigest(token) {
  return createHash("sha256").update(token).digest("hex");
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, PASSWORD_KEY_LENGTH);
  return { salt, hash: hash.toString("hex") };
}

export async function issuePasswordReset(email) {
  if (typeof email !== "string") return null;
  const normalizedEmail = email.trim().toLowerCase();
  if (
    normalizedEmail.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
    !normalizedEmail.endsWith("@beoneofus.com")
  ) {
    return null;
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = tokenDigest(token);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_LIFETIME_MS).toISOString();
  const userEmail = await withDatabase((database) => {
    const user = database.users.find((item) => item.email === normalizedEmail);
    if (!user) return null;
    user.passwordResetTokenHash = tokenHash;
    user.passwordResetExpiresAt = expiresAt;
    user.updatedAt = new Date().toISOString();
    return user.email;
  });

  return userEmail ? { email: userEmail, token, tokenHash } : null;
}

export async function discardPasswordReset(tokenHash) {
  await withDatabase((database) => {
    const user = database.users.find((item) => item.passwordResetTokenHash === tokenHash);
    if (!user) return;
    delete user.passwordResetTokenHash;
    delete user.passwordResetExpiresAt;
    user.updatedAt = new Date().toISOString();
  });
}

export async function resetAccountPassword({ token, password }) {
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    throw new AccountError("Password must be between 8 and 128 characters.");
  }
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new AccountError("This reset link is invalid or has expired.", 400);
  }

  const digest = tokenDigest(token);
  const isValid = await withDatabase((database) => {
    const user = database.users.find((item) => item.passwordResetTokenHash === digest);
    if (!user) return false;
    const expiresAt = Date.parse(user.passwordResetExpiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      delete user.passwordResetTokenHash;
      delete user.passwordResetExpiresAt;
      return false;
    }
    return true;
  });
  if (!isValid) throw new AccountError("This reset link is invalid or has expired.", 400);

  const credentials = await hashPassword(password);
  const updated = await withDatabase((database) => {
    const user = database.users.find((item) => item.passwordResetTokenHash === digest);
    const expiresAt = Date.parse(user?.passwordResetExpiresAt);
    if (!user || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      if (user) {
        delete user.passwordResetTokenHash;
        delete user.passwordResetExpiresAt;
      }
      return false;
    }
    user.passwordSalt = credentials.salt;
    user.passwordHash = credentials.hash;
    delete user.passwordResetTokenHash;
    delete user.passwordResetExpiresAt;
    user.updatedAt = new Date().toISOString();
    database.sessions = database.sessions.filter((session) => session.userId !== user.id);
    return true;
  });
  if (!updated) throw new AccountError("This reset link is invalid or has expired.", 400);
  return updated;
}
