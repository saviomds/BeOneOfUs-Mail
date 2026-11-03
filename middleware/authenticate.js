import { findUserForSession } from "../services/session.service.js";

function readCookie(request, name) {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return null;
}

export async function authenticate(request, response, next) {
  try {
    const token = readCookie(request, "beoneofus_session");
    if (!token) {
      response.status(401).json({ error: "Please sign in to continue." });
      return;
    }

    const user = await findUserForSession(token);
    if (!user) {
      response.status(401).json({ error: "Your session has expired. Please sign in again." });
      return;
    }

    request.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

export async function authenticatePage(request, response, next) {
  try {
    const token = readCookie(request, "beoneofus_session");
    const user = token ? await findUserForSession(token) : null;
    if (!user) {
      response.redirect("/login");
      return;
    }
    request.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

export function readSessionCookie(request) {
  return readCookie(request, "beoneofus_session");
}