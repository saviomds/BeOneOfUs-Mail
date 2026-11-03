import { createHash, randomBytes } from "node:crypto";
import { withDatabase } from "./json-database.service.js";

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId) {
  const token = randomBytes(32).toString("base64url");
  const session = {
    id: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS).toISOString(),
    createdAt: new Date().toISOString(),
  };
  await withDatabase((database) => {
    database.sessions = database.sessions.filter(
      (item) => new Date(item.expiresAt).getTime() > Date.now(),
    );
    database.sessions.push(session);
  });
  return { token, maxAge: SESSION_LIFETIME_MS };
}

export async function findUserForSession(token) {
  const sessionId = hashToken(token);
  return withDatabase((database) => {
    const session = database.sessions.find((item) => item.id === sessionId);
    if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
      if (session) database.sessions = database.sessions.filter((item) => item.id !== sessionId);
      return null;
    }
    const user = database.users.find((item) => item.id === session.userId);
    if (!user || (user.status ?? "pending") !== "approved") {
      database.sessions = database.sessions.filter((item) => item.id !== sessionId);
      return null;
    }
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      bio: user.bio,
      phone: user.phone ?? "",
      location: user.location ?? "",
      position: user.position ?? "",
      profilePhoto: user.profilePhoto ?? "",
      avatarSticker: user.avatarSticker ?? "",
      status: user.status,
      role: user.role ?? "member",
    };
  });
}

export async function deleteSession(token) {
  if (!token) return;
  const sessionId = hashToken(token);
  await withDatabase((database) => {
    database.sessions = database.sessions.filter((item) => item.id !== sessionId);
  });
}
