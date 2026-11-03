import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const temporaryDirectory = await mkdtemp(join(tmpdir(), "beoneofus-mail-e2e-"));
process.env.JSON_DATABASE_PATH = join(temporaryDirectory, "mail-database.json");
process.env.APP_SETTINGS_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const adminEmail = "e2e-admin@beoneofus.com";
const adminPassword = "e2e-admin-test-password";
const { registerAccount } = await import("../services/account.service.js");
const { promoteAccountToAdmin } = await import("../services/admin.service.js");
const { createApp } = await import("../app.js");

await registerAccount({ name: "E2E Admin", email: adminEmail, password: adminPassword });
await promoteAccountToAdmin(adminEmail);

const server = createApp({
  smtpTestEmail: async (settings, recipient) => {
    if (!settings.host || !settings.from || !recipient) {
      throw new Error("SMTP test settings were incomplete.");
    }
  },
  supabaseConnectionTest: async ({ projectUrl, apiKey }) => {
    if (!projectUrl.startsWith("https://") || !apiKey) {
      throw new Error("Supabase connection settings were incomplete.");
    }
  },
}).listen(Number(process.env.PORT || 4173), "127.0.0.1", () => {
  console.log("Playwright test server is ready.");
});

let closing = false;
async function closeServer() {
  if (closing) return;
  closing = true;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  await rm(temporaryDirectory, { recursive: true, force: true });
}

process.once("SIGINT", () => void closeServer().then(() => process.exit(0)));
process.once("SIGTERM", () => void closeServer().then(() => process.exit(0)));
process.once("uncaughtException", (error) => {
  console.error(error);
  void closeServer().finally(() => process.exit(1));
});
