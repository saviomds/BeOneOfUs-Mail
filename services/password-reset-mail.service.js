import nodemailer from "nodemailer";
import { getSmtpSettingsForDelivery } from "./smtp-settings.service.js";

export async function sendPasswordResetEmail({ to, url }) {
  const settings = await getSmtpSettingsForDelivery();
  if (!settings) throw new Error("Password recovery SMTP settings are incomplete.");
  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    requireTLS: !settings.secure,
    auth: settings.username ? { user: settings.username, pass: settings.password } : undefined,
  });
  try {
    await transport.sendMail({
      from: settings.from,
      to,
      subject: "Reset your BeOneOfUs Mail password",
      text: [
        "We received a request to reset your BeOneOfUs Mail password.",
        "",
        `Use this one-time link within 30 minutes: ${url}`,
        "",
        "If you did not request this, you can ignore this email.",
      ].join("\n"),
    });
  } finally {
    transport.close();
  }
}
