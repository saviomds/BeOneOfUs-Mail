import express from "express";
import { fileURLToPath } from "node:url";
import adminRoutes from "./routes/admin.routes.js";
import authRoutes from "./routes/auth.routes.js";
import mailRoutes from "./routes/mail.routes.js";
import pageRoutes from "./routes/page.routes.js";
import userRoutes from "./routes/user.routes.js";
import { sendPasswordResetEmail } from "./services/password-reset-mail.service.js";

const publicDirectory = fileURLToPath(new URL("./public/", import.meta.url));

export function createApp({ passwordResetMailer, smtpTestEmail, supabaseConnectionTest } = {}) {
  const app = express();
  app.locals.passwordResetMailer = passwordResetMailer ?? sendPasswordResetEmail;
  app.locals.passwordResetMailerInjected = Boolean(passwordResetMailer);
  app.locals.smtpTestEmail = smtpTestEmail;
  app.locals.supabaseConnectionTest = supabaseConnectionTest;
  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    );
    next();
  });
  app.use(express.json({ limit: "24mb" }));

  app.use("/api", (_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/api/admin", adminRoutes);
  app.use("/api/auth", authRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api", mailRoutes);
  app.use(pageRoutes);
  app.use(express.static(publicDirectory));

  app.use((error, _request, response, _next) => {
    if (error instanceof SyntaxError && "body" in error) {
      response.status(400).json({ error: "Request body must be valid JSON." });
      return;
    }
    if (error?.type === "entity.too.large") {
      response.status(413).json({ error: "Request body is too large." });
      return;
    }
    console.error("Unhandled server error.", error);
    response.status(500).json({ error: "Something went wrong. Please try again." });
  });

  return app;
}
