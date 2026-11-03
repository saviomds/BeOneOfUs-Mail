import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = fileURLToPath(new URL("../", import.meta.url));
const databasePath = resolve(
  process.env.JSON_DATABASE_PATH || resolve(projectDirectory, "data", "mail-database.json"),
);

let operationQueue = Promise.resolve();

function emptyDatabase() {
  return {
    version: 1,
    users: [],
    sessions: [],
    mailboxes: {},
    attachmentFiles: {},
    notifications: [],
    adminAuditLog: [],
    settings: {},
  };
}

async function readDatabase() {
  try {
    const raw = await readFile(databasePath, "utf8");
    const database = JSON.parse(raw);
    if (
      database?.version !== 1 ||
      !Array.isArray(database.users) ||
      !Array.isArray(database.sessions) ||
      !database.mailboxes ||
      typeof database.mailboxes !== "object" ||
      Array.isArray(database.mailboxes)
    ) {
      throw new Error("The JSON database has an unsupported or invalid structure.");
    }
    if (database.notifications === undefined) database.notifications = [];
    if (!Array.isArray(database.notifications)) {
      throw new Error("The JSON database notifications are invalid.");
    }
    if (database.adminAuditLog === undefined) database.adminAuditLog = [];
    if (!Array.isArray(database.adminAuditLog)) {
      throw new Error("The JSON database admin audit log is invalid.");
    }
    if (database.settings === undefined) database.settings = {};
    if (!database.settings || typeof database.settings !== "object" || Array.isArray(database.settings)) {
      throw new Error("The JSON database settings are invalid.");
    }
    if (database.attachmentFiles === undefined) database.attachmentFiles = {};
    if (
      !database.attachmentFiles ||
      typeof database.attachmentFiles !== "object" ||
      Array.isArray(database.attachmentFiles)
    ) {
      throw new Error("The JSON database attachments are invalid.");
    }
    return database;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return emptyDatabase();
  }
}

async function writeDatabase(database) {
  await mkdir(dirname(databasePath), { recursive: true });
  const temporaryPath = `${databasePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(database, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, databasePath);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch (cleanupError) {
      if (cleanupError.code !== "ENOENT") {
        console.error("Could not remove the incomplete JSON database file.", cleanupError);
      }
    }
    throw error;
  }
}

export function withDatabase(operation) {
  const result = operationQueue.then(async () => {
    const database = await readDatabase();
    const value = await operation(database);
    await writeDatabase(database);
    return value;
  });
  operationQueue = result.catch(() => {});
  return result;
}
