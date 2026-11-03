import { randomBytes } from "node:crypto";
import { AccountError } from "./errors.js";
import { decryptSettingsSecret, encryptSettingsSecret } from "./settings-crypto.service.js";
import { withDatabase } from "./json-database.service.js";

function validateProjectUrl(value) {
  if (typeof value !== "string" || value.length > 255) {
    throw new AccountError("Enter a valid Supabase project URL.");
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new AccountError("Enter a valid Supabase project URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname) ||
    !/^[a-z0-9][a-z0-9-]*\.supabase\.co$/.test(url.hostname)
  ) {
    throw new AccountError("Use an HTTPS Supabase project URL such as https://project-ref.supabase.co.");
  }
  return url.origin;
}

function validateApiKey(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 4096 || /[\r\n]/.test(value)) {
    throw new AccountError("Enter a valid Supabase API key.");
  }
  return value.trim();
}

function publicSettings(settings) {
  return {
    provider: "supabase",
    projectUrl: settings?.projectUrl ?? "",
    apiKeyConfigured: Boolean(settings?.apiKeyEncrypted),
    configured: Boolean(settings?.projectUrl && settings?.apiKeyEncrypted),
    activeDatabase: "json",
    active: false,
    updatedAt: settings?.updatedAt ?? null,
  };
}

export async function getSupabaseSettingsSummary() {
  return withDatabase((database) => publicSettings(database.settings.supabase));
}

export async function getSupabaseConnectionSettings(input) {
  const projectUrl = validateProjectUrl(input.projectUrl);
  const database = await withDatabase((stored) => stored.settings.supabase ?? null);
  const apiKey = typeof input.apiKey === "string" && input.apiKey.trim()
    ? validateApiKey(input.apiKey)
    : database?.projectUrl === projectUrl && database.apiKeyEncrypted
      ? decryptSettingsSecret(database.apiKeyEncrypted)
      : "";
  if (!apiKey) throw new AccountError("Enter a Supabase API key.");
  return { projectUrl, apiKey };
}

export async function saveSupabaseSettings(actor, input, verifyAdminPassword) {
  await verifyAdminPassword(actor.id, input.passwordConfirmation);
  const { projectUrl, apiKey } = await getSupabaseConnectionSettings(input);
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
    database.settings.supabase = {
      projectUrl,
      apiKeyEncrypted: encryptSettingsSecret(apiKey),
      updatedAt: now,
      updatedBy: currentActor.id,
    };
    database.adminAuditLog.push({
      id: `audit-database-${randomBytes(12).toString("hex")}`,
      actorId: currentActor.id,
      actorName: currentActor.name,
      actorEmail: currentActor.email,
      targetId: "system",
      targetName: "Supabase connection settings",
      targetEmail: "",
      action: "database_settings_updated",
      previousStatus: "configured",
      status: "configured",
      reason: "Updated future Supabase database connection settings; JSON remains active.",
      createdAt: now,
    });
    if (database.adminAuditLog.length > 1000) {
      database.adminAuditLog.splice(0, database.adminAuditLog.length - 1000);
    }
  });
  return getSupabaseSettingsSummary();
}

export async function testSupabaseConnection(
  input,
  probe = probeSupabaseRest,
) {
  const settings = await getSupabaseConnectionSettings(input);
  await probe(settings);
}

async function probeSupabaseRest({ projectUrl, apiKey }) {
  let response;
  try {
    response = await fetch(`${projectUrl}/rest/v1/`, {
      method: "GET",
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
      },
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    const code = error?.name === "TimeoutError" ? "TIMEOUT" : "CONNECTION_FAILED";
    throw new AccountError(`Supabase connection test failed (${code}). Check the project URL and network.`, 502);
  }
  if (!response.ok) {
    throw new AccountError(
      `Supabase connection test failed (HTTP ${response.status}). Check the project URL and API key.`,
      502,
    );
  }
}
