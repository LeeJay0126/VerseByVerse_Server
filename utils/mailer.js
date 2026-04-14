const nodemailer = require("nodemailer");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

let transporter;

const DEFAULT_APP_URL = "http://localhost:3000";

function getAppUrl() {
  return process.env.APP_URL || DEFAULT_APP_URL;
}

function buildAuthActionUrl(pathname, { email, token }) {
  const url = new URL(pathname, getAppUrl());
  url.searchParams.set("email", email);
  url.searchParams.set("token", token);
  return url.toString();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getTransporter() {
  if (transporter) return transporter;

  const host = requireEnv("SMTP_HOST");
  const port = Number(process.env.SMTP_PORT || 587);
  const user = requireEnv("SMTP_USER");
  const pass = requireEnv("SMTP_PASS");
  const secure = String(process.env.SMTP_SECURE || "false") === "true";

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  return transporter;
}

async function sendMail({ to, subject, html, text }) {
  const from = process.env.MAIL_FROM || requireEnv("SMTP_USER");
  const t = getTransporter();
  return t.sendMail({ from, to, subject, html, text });
}

function buildVerifyUrl({ email, token }) {
  return buildAuthActionUrl("/verify-email", { email, token });
}

function buildResetUrl({ email, token }) {
  return buildAuthActionUrl("/reset-password", { email, token });
}

function buildVerifyEmail({ appName, verifyUrl }) {
  const subject = `${appName}: Verify your email`;
  const escapedVerifyUrl = escapeHtml(verifyUrl);
  const text = `Verify your email by opening this link:\n${verifyUrl}\n\nIf you didn't create this account, you can ignore this email.`;

  const html = `
  <div style="font-family: Arial, sans-serif; line-height:1.4;">
    <h2 style="margin:0 0 12px;">Verify your email</h2>
    <p style="margin:0 0 12px;">
      Click the button below to verify your email address.
    </p>
    <p style="margin:0 0 16px;">
      <a href="${escapedVerifyUrl}"
         style="display:inline-block;padding:10px 14px;border-radius:10px;text-decoration:none;background:#160000;color:#F5EAEA;font-weight:700;">
        Verify Email
      </a>
    </p>
    <p style="margin:0 0 8px;color:#444;">
      Or copy and paste this link:
    </p>
    <p style="margin:0 0 0;word-break:break-all;color:#555;">
      ${escapedVerifyUrl}
    </p>
    <hr style="margin:18px 0;border:none;border-top:1px solid #eee;" />
    <p style="margin:0;color:#777;font-size:12px;">
      If you didn't create this account, you can safely ignore this email.
    </p>
  </div>`;

  return { subject, html, text };
}

function buildResetEmail({ appName, resetUrl }) {
  const subject = `${appName}: Reset your password`;
  const escapedResetUrl = escapeHtml(resetUrl);
  const text =
    `Reset your password by opening this link:\n${resetUrl}\n\n` +
    `If you didn't request this, you can ignore this email.`;

  const html = `
    <div style="font-family: Arial, sans-serif; line-height:1.4;">
      <h2 style="margin:0 0 12px;">Reset your password</h2>
      <p style="margin:0 0 24px;">
        Click the button below to choose a new password.
      </p>
      <p style="margin:0 0 24px;">
        <a href="${escapedResetUrl}"
           style="display:inline-block;padding:10px 14px;border-radius:10px;text-decoration:none;background:#160000;color:#F5EAEA;font-weight:700;">
          Reset Password
        </a>
      </p>
      <p style="margin:0 0 8px;color:#444;">
        Or copy and paste this link:
      </p>
      <p style="margin:0 0 0;word-break:break-all;color:#555;">
        ${escapedResetUrl}
      </p>
      <hr style="margin:18px 0;border:none;border-top:1px solid #eee;" />
      <p style="margin:0;color:#777;font-size:12px;">
        If you didn't request this, you can safely ignore this email.
      </p>
    </div>`;
  return { subject, html, text };
}

module.exports = {
  sendMail,
  buildVerifyUrl,
  buildResetUrl,
  buildVerifyEmail,
  buildResetEmail,
};
