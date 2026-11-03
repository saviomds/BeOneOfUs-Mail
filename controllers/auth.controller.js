import { authenticateAccount, registerAccount } from "../services/account.service.js";
import { AccountError } from "../services/errors.js";
import { deleteSession, createSession } from "../services/session.service.js";
import {
  discardPasswordReset,
  issuePasswordReset,
  resetAccountPassword,
} from "../services/password-reset.service.js";
import { sendPasswordResetEmail } from "../services/password-reset-mail.service.js";
import { getSmtpSettingsForDelivery } from "../services/smtp-settings.service.js";
import { readSessionCookie } from "../middleware/authenticate.js";

const COOKIE_NAME = "beoneofus_session";

function sessionCookie(response, token, maxAge) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(maxAge / 1000)}${secure}`,
  );
}

function clearSessionCookie(response) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`,
  );
}

function sendError(response, error) {
  if (error instanceof AccountError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  console.error("Authentication request failed.", error);
  response.status(500).json({ error: "The request could not be completed. Please try again." });
}

export async function register(request, response) {
  try {
    const user = await registerAccount(request.body ?? {});
    response.status(202).json({
      user,
      message: "Your company account request was sent to an administrator for approval.",
    });
  } catch (error) {
    sendError(response, error);
  }
}

export async function login(request, response) {
  try {
    const user = await authenticateAccount(request.body ?? {});
    const session = await createSession(user.id);
    sessionCookie(response, session.token, session.maxAge);
    response.json({ user });
  } catch (error) {
    sendError(response, error);
  }
}

export async function logout(request, response) {
  try {
    await deleteSession(readSessionCookie(request));
    clearSessionCookie(response);
    response.json({ success: true });
  } catch (error) {
    sendError(response, error);
  }
}

export async function requestPasswordReset(request, response) {
  let reset;
  try {
    const settings = await getSmtpSettingsForDelivery();
    if (!settings && !request.app.locals.passwordResetMailerInjected) {
      response.status(503).json({ error: "Password recovery email delivery is not configured." });
      return;
    }

    const appBaseUrl = process.env.APP_BASE_URL ||
      (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000");
    const baseUrl = new URL(appBaseUrl);
    if (
      !["http:", "https:"].includes(baseUrl.protocol) ||
      baseUrl.username ||
      baseUrl.password ||
      !["", "/"].includes(baseUrl.pathname) ||
      baseUrl.search ||
      baseUrl.hash ||
      (process.env.NODE_ENV === "production" && baseUrl.protocol !== "https:")
    ) {
      throw new Error("APP_BASE_URL must be an origin (HTTPS in production).");
    }
    baseUrl.pathname = "/reset-password";

    reset = await issuePasswordReset(request.body?.email);
    if (reset) {
      baseUrl.hash = new URLSearchParams({ token: reset.token }).toString();
      const deliver = request.app.locals.passwordResetMailer ?? sendPasswordResetEmail;
      await deliver({ to: reset.email, url: baseUrl.toString() });
    }
    response.status(202).json({
      message: "If an account exists for that address, a password reset link will be sent.",
    });
  } catch (error) {
    if (reset) {
      try {
        await discardPasswordReset(reset.tokenHash);
      } catch (cleanupError) {
        console.error("Could not invalidate an undelivered password reset token.", cleanupError);
      }
    }
    console.error("Password reset email could not be delivered.", error);
    response.status(502).json({ error: "The reset email could not be sent. Please try again later." });
  }
}

export async function resetPassword(request, response) {
  try {
    await resetAccountPassword({
      token: request.body?.token,
      password: request.body?.password,
    });
    response.json({ message: "Your password has been reset. You can now sign in." });
  } catch (error) {
    sendError(response, error);
  }
}

export function currentUser(request, response) {
  response.json({ user: request.user });
}