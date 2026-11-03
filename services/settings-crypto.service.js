import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AccountError } from "./errors.js";

function encryptionKey() {
  const encoded = process.env.APP_SETTINGS_ENCRYPTION_KEY ??
    process.env.SMTP_SETTINGS_ENCRYPTION_KEY;
  if (!encoded) return null;
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new AccountError(
      "APP_SETTINGS_ENCRYPTION_KEY must be a base64-encoded 32-byte key.",
      503,
    );
  }
  return key;
}

export function isSettingsEncryptionKeyConfigured() {
  return Boolean(encryptionKey());
}

export function encryptSettingsSecret(secret) {
  const key = encryptionKey();
  if (!key) {
    throw new AccountError(
      "Set APP_SETTINGS_ENCRYPTION_KEY on the server before saving admin-managed settings.",
      503,
    );
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptSettingsSecret(encrypted) {
  const key = encryptionKey();
  if (!key) {
    throw new AccountError("Settings cannot be decrypted. Configure APP_SETTINGS_ENCRYPTION_KEY.", 503);
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encrypted.iv, "base64"));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
