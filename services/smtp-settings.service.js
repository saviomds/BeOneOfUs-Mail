import { randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import { AccountError } from "./errors.js";
import { withDatabase } from "./json-database.service.js";
import {
  decryptSettingsSecret,
  encryptSettingsSecret,
  isSettingsEncryptionKeyConfigured,
} from "./settings-crypto.service.js";

function environmentSettings() {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_FROM, SMTP_USER, SMTP_PASSWORD } = process.env;
  return {
    host: SMTP_HOST ?? "",
    port: SMTP_PORT ? Number(SMTP_PORT) : 587,
    secure: SMTP_SECURE === "true" || (SMTP_PORT || "587") === "465",
    from: SMTP_FROM ?? "",
    username: SMTP_USER ?? "",
    password: SMTP_PASSWORD ?? "",
    source: "environment",
  };
}

async function activeSettings() {
  const stored = await withDatabase((database) => database.settings.smtp ?? null);
  if (!stored) return environmentSettings();
  if (!isSettingsEncryptionKeyConfigured() && stored.passwordEncrypted) {
    throw new AccountError("SMTP settings cannot be decrypted. Configure APP_SETTINGS_ENCRYPTION_KEY.", 503);
  }
  return {
    host: stored.host,
    port: stored.port,
    secure: stored.secure,
    from: stored.from,
    username: stored.username,
    password: stored.passwordEncrypted ? decryptSettingsSecret(stored.passwordEncrypted) : "",
    source: "admin",
  };
}

function validateSettings(settings) {
  const host = typeof settings.host === "string" ? settings.host.trim() : "";
  const from = typeof settings.from === "string" ? settings.from.trim() : "";
  const username = typeof settings.username === "string" ? settings.username.trim() : "";
  const password = typeof settings.password === "string" ? settings.password : "";
  const port = Number(settings.port);

  if (
    !host ||
    host.length > 255 ||
    !/^[A-Za-z0-9.-]+$/.test(host)
  ) {
    throw new AccountError("Enter a valid SMTP hostname.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new AccountError("Enter an SMTP port between 1 and 65535.");
  }
  const senderMatch = /^(?:([^<>\r\n]+)\s+<([^<>\s]+@[^<>\s]+)>|([^<>\s]+@[^<>\s]+))$/.exec(from);
  const senderAddress = senderMatch?.[2] ?? senderMatch?.[3] ?? "";
  if (
    !from ||
    from.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderAddress)
  ) {
    throw new AccountError("Enter a valid sender email address (for example, mail@beoneofus.com).");
  }
  if (username.length > 254 || /[\r\n]/.test(username)) {
    throw new AccountError("Enter a valid SMTP username.");
  }
  if (password.length > 1024 || /[\r\n]/.test(password)) {
    throw new AccountError("Enter a valid SMTP password.");
  }
  if (Boolean(username) !== Boolean(password)) {
    throw new AccountError("Enter both the SMTP username and password, or leave both blank.");
  }
  if (typeof settings.secure !== "boolean") {
    throw new AccountError("Choose whether the SMTP connection uses implicit TLS.");
  }

  return { host, port, secure: settings.secure, from, username, password };
}

function createTransport(settings) {
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    requireTLS: !settings.secure,
    auth: settings.username
      ? { user: settings.username, pass: settings.password }
      : undefined,
  });
}

function publicSettings(settings, keyConfigured) {
  const { password, ...safeSettings } = settings;
  return {
    ...safeSettings,
    passwordConfigured: Boolean(password),
    configured: Boolean(settings.host && settings.from && (!settings.username || password)),
    encryptionKeyConfigured: keyConfigured,
  };
}

export async function getSmtpSettingsSummary() {
  const settings = await activeSettings();
  return publicSettings(settings, isSettingsEncryptionKeyConfigured());
}

export async function getSmtpSettingsForDelivery() {
  const settings = await activeSettings();
  if (!settings.host || !settings.from || (settings.username && !settings.password)) {
    return null;
  }
  return settings;
}

async function settingsFromInput(input) {
  const previous = await activeSettings();
  const username = typeof input.username === "string" ? input.username.trim() : "";
  const suppliedPassword = typeof input.password === "string" ? input.password : "";
  const password = suppliedPassword || (username && username === previous.username
    ? previous.password
    : "");
  return validateSettings({
    host: input.host,
    port: input.port,
    secure: input.secure,
    from: input.from,
    username,
    password,
  });
}

export async function saveSmtpSettings(actor, input, verifyAdminPassword) {
  await verifyAdminPassword(actor.id, input.passwordConfirmation);
  if (!isSettingsEncryptionKeyConfigured()) {
    throw new AccountError(
      "Set APP_SETTINGS_ENCRYPTION_KEY on the server before saving admin-managed SMTP settings.",
      503,
    );
  }
  const settings = await settingsFromInput(input);
  const now = new Date().toISOString();
  await withDatabase((database) => {
    const currentActor = database.users.find((user) => user.id === actor.id);
    if (
      !currentActor ||
      (currentActor.role ?? "member") !== "admin" ||
      (currentActor.status ?? "pending") !== "approved"
    ) {
      throw new AccountError("Admin access is no longer available.", 403);
    }
    database.settings.smtp = {
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      from: settings.from,
      username: settings.username,
      passwordEncrypted: settings.password ? encryptSettingsSecret(settings.password) : null,
      updatedAt: now,
      updatedBy: currentActor.id,
    };
    database.adminAuditLog.push({
      id: `audit-smtp-${randomBytes(12).toString("hex")}`,
      actorId: currentActor.id,
      actorName: currentActor.name,
      actorEmail: currentActor.email,
      targetId: "system",
      targetName: "SMTP email delivery",
      targetEmail: "",
      action: "smtp_settings_updated",
      previousStatus: "configured",
      status: "configured",
      reason: "Updated SMTP email delivery settings.",
      createdAt: now,
    });
    if (database.adminAuditLog.length > 1000) {
      database.adminAuditLog.splice(0, database.adminAuditLog.length - 1000);
    }
  });
  return getSmtpSettingsSummary();
}

export async function sendSmtpTestEmail(settings, recipient) {
  const transport = createTransport(settings);
  try {
    await transport.sendMail({
      from: settings.from,
      to: recipient,
      subject: "BeOneOfUs Mail SMTP test",
      text: "SMTP is configured and BeOneOfUs Mail can deliver email.",
    });
  } catch (error) {
    const safeCode = typeof error?.code === "string" && /^[A-Z0-9_-]{1,24}$/.test(error.code)
      ? error.code
      : "SMTP_ERROR";
    console.error("SMTP test email delivery failed.", { code: safeCode });
    throw new AccountError(
      `The SMTP test email could not be delivered (${safeCode}). Check the host, port, TLS, and authentication settings.`,
      502,
    );
  } finally {
    transport.close();
  }
}

export async function testSmtpSettings(
  actor,
  input,
  verifyAdminPassword,
  deliverTestEmail = sendSmtpTestEmail,
) {
  await verifyAdminPassword(actor.id, input.passwordConfirmation);
  const settings = await settingsFromInput(input);
  await deliverTestEmail(settings, actor.email);
}
