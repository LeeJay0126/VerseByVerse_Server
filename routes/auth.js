const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const User = require("../models/User");
const zxcvbn = require("zxcvbn");
const { sendMail, buildVerifyEmail } = require("../utils/mailer");

const router = express.Router();

const MAX_NAME_LEN = 20;
const MAX_USERNAME_LEN = 20;

const MIN_PW_LEN = 10;
const MAX_PW_LEN = 72;

const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const usernamePattern = /^[a-zA-Z0-9._]+$/;

const VERIFY_TOKEN_TTL_MS = 1000 * 60 * 60 * 24; // 24h
const RESEND_COOLDOWN_MS = 1000 * 60; // 60s

const PW_RESET_TOKEN_TTL_MS = 1000 * 60 * 30; // 30m
const PW_RESET_COOLDOWN_MS = 1000 * 60; // 60s

const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password123",
  "1234567890",
  "12345678",
  "123456789",
  "qwerty",
  "qwerty123",
  "11111111",
  "00000000",
  "letmein",
  "admin",
  "iloveyou",
  "welcome",
]);

const normalizeSpaces = (s) => String(s || "").replace(/\s+/g, " ").trim();

const validateName = (value, label) => {
  const v = normalizeSpaces(value);
  if (!v) return { ok: false, error: `${label} required` };
  if (v.length > MAX_NAME_LEN) return { ok: false, error: `${label} too long` };
  return { ok: true, value: v };
};

const validateEmail = (value) => {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return { ok: false, error: "email required" };
  if (v.length > 254) return { ok: false, error: "email too long" };
  if (!emailRegex.test(v)) return { ok: false, error: "invalid email" };
  return { ok: true, value: v };
};

const validateUsername = (value) => {
  const v = String(value || "").trim().toLowerCase();

  if (!v) return { ok: false, error: "username required" };
  if (v.length < 4) return { ok: false, error: "username too short" };
  if (v.length > MAX_USERNAME_LEN) return { ok: false, error: "username too long" };
  if (!usernamePattern.test(v)) return { ok: false, error: "invalid username chars" };

  if (v.startsWith(".") || v.startsWith("_") || v.endsWith(".") || v.endsWith("_")) {
    return { ok: false, error: "invalid username format" };
  }

  if (v.includes("..") || v.includes("__") || v.includes("._") || v.includes("_.")) {
    return { ok: false, error: "invalid username format" };
  }

  return { ok: true, value: v };
};

const getPwUserInputs = ({ username, email, firstName, lastName }) => {
  const list = [
    username,
    email,
    firstName,
    lastName,
    ...(email && email.includes("@") ? [email.split("@")[0]] : []),
  ]
    .map((s) => String(s || "").toLowerCase().trim())
    .filter(Boolean);

  return Array.from(new Set(list));
};

const validatePassword = (password, userInputs) => {
  const pw = String(password || "");

  if (!pw) return { ok: false, code: "PW_REQUIRED", error: "password required" };
  if (pw.length < MIN_PW_LEN) return { ok: false, code: "PW_TOO_SHORT", error: "password too short" };
  if (pw.length > MAX_PW_LEN) return { ok: false, code: "PW_TOO_LONG", error: "password too long" };

  if (COMMON_PASSWORDS.has(pw.toLowerCase())) {
    return { ok: false, code: "PW_COMMON", error: "password too common" };
  }

  const z = zxcvbn(pw, userInputs || []);
  if ((z?.score ?? 0) < 3) {
    return {
      ok: false,
      code: "PW_WEAK",
      error: "password too weak",
      score: z?.score ?? 0,
      feedback: z?.feedback || null,
    };
  }

  return { ok: true, score: z?.score ?? 0 };
};

function sha256Hex(input) {
  return crypto.createHash("sha256").update(String(input)).digest("hex");
}

function buildVerifyUrl({ email, token }) {
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const url = new URL("/verify-email", appUrl);
  url.searchParams.set("email", email);
  url.searchParams.set("token", token);
  return url.toString();
}

function buildResetUrl({ email, token }) {
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  // your frontend route should exist: /reset-password
  const url = new URL("/reset-password", appUrl);
  url.searchParams.set("email", email);
  url.searchParams.set("token", token);
  return url.toString();
}

function buildResetEmail({ appName, resetUrl }) {
  const subject = `${appName}: Reset your password`;
  const text =
    `Reset your password by opening this link:\n${resetUrl}\n\n` +
    `If you didn’t request this, you can ignore this email.`;

  const html = `
    <div style="font-family: Arial, sans-serif; line-height:1.4;">
      <h2 style="margin:0 0 12px;">Reset your password</h2>
      <p style="margin:0 0 12px;">
        Click the button below to choose a new password.
      </p>
      <p style="margin:0 0 16px;">
        <a href="${resetUrl}"
           style="display:inline-block;padding:10px 14px;border-radius:10px;text-decoration:none;background:#160000;color:#F5EAEA;font-weight:700;">
          Reset Password
        </a>
      </p>
      <p style="margin:0 0 8px;color:#444;">
        Or copy and paste this link:
      </p>
      <p style="margin:0 0 0;word-break:break-all;color:#555;">
        ${resetUrl}
      </p>
      <hr style="margin:18px 0;border:none;border-top:1px solid #eee;" />
      <p style="margin:0;color:#777;font-size:12px;">
        If you didn’t request this, you can safely ignore this email.
      </p>
    </div>`;
  return { subject, html, text };
}

async function issueAndSendVerifyEmail(user) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = sha256Hex(rawToken);

  user.emailVerifyTokenHash = tokenHash;
  user.emailVerifyTokenExpiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS);
  user.emailVerifyLastSentAt = new Date();
  await user.save();

  const verifyUrl = buildVerifyUrl({ email: user.email, token: rawToken });
  const appName = process.env.APP_NAME || "App";
  const { subject, html, text } = buildVerifyEmail({ appName, verifyUrl });

  const info = await sendMail({ to: user.email, subject, html, text });
  console.log("[verify email sent]", { to: user.email, messageId: info?.messageId });
}

async function issueAndSendPasswordResetEmail(user) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = sha256Hex(rawToken);

  user.passwordResetTokenHash = tokenHash;
  user.passwordResetTokenExpiresAt = new Date(Date.now() + PW_RESET_TOKEN_TTL_MS);
  user.passwordResetLastSentAt = new Date();
  await user.save();

  const resetUrl = buildResetUrl({ email: user.email, token: rawToken });
  const appName = process.env.APP_NAME || "App";
  const { subject, html, text } = buildResetEmail({ appName, resetUrl });

  const info = await sendMail({ to: user.email, subject, html, text });
  console.log("[pw reset email sent]", { to: user.email, messageId: info?.messageId });
}

/**
 * POST /auth/signup
 */
router.post("/signup", async (req, res) => {
  try {
    const body = req.body || {};

    const firstNameV = validateName(body.firstName, "firstName");
    if (!firstNameV.ok) return res.status(400).json({ ok: false, error: firstNameV.error });

    const lastNameV = validateName(body.lastName, "lastName");
    if (!lastNameV.ok) return res.status(400).json({ ok: false, error: lastNameV.error });

    const emailV = validateEmail(body.email);
    if (!emailV.ok) return res.status(400).json({ ok: false, error: emailV.error });

    const usernameV = validateUsername(body.username);
    if (!usernameV.ok) return res.status(400).json({ ok: false, error: usernameV.error });

    const userInputs = getPwUserInputs({
      username: usernameV.value,
      email: emailV.value,
      firstName: firstNameV.value,
      lastName: lastNameV.value,
    });

    const pwV = validatePassword(body.password, userInputs);
    if (!pwV.ok) {
      return res.status(400).json({
        ok: false,
        error: pwV.error,
        code: pwV.code,
        score: pwV.score,
        feedback: pwV.feedback,
      });
    }

    const firstName = firstNameV.value;
    const lastName = lastNameV.value;
    const email = emailV.value;
    const username = usernameV.value;

    const exists = await User.findOne({ $or: [{ email }, { username }] });
    if (exists) {
      if (exists.email === email) {
        return res.status(409).json({ ok: false, code: "EMAIL_TAKEN", error: "Email already registered" });
      }
      if (exists.username === username) {
        return res.status(409).json({ ok: false, code: "USERNAME_TAKEN", error: "Username already taken" });
      }
      return res.status(409).json({ ok: false, code: "ACCOUNT_EXISTS", error: "Account already exists" });
    }

    const hash = await bcrypt.hash(String(body.password), 10);

    const user = await User.create({
      firstName,
      lastName,
      email,
      username,
      password: hash,
      emailVerified: false,
    });

    try {
      await issueAndSendVerifyEmail(user);
    } catch (mailErr) {
      console.error("[verify email send error]", mailErr);
      return res.status(201).json({
        ok: true,
        user: {
          id: user._id,
          email: user.email,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          emailVerified: user.emailVerified,
        },
        verification: { sent: false },
      });
    }

    return res.status(201).json({
      ok: true,
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        emailVerified: user.emailVerified,
      },
      verification: { sent: true },
    });
  } catch (e) {
    console.error("[signup error]", e);
    if (e?.code === 11000) {
      return res.status(409).json({
        ok: false,
        code: "DUPLICATE_KEY",
        error: "Email or username already registered",
      });
    }
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * GET /auth/verify-email?email=...&token=...
 */
router.get("/verify-email", async (req, res) => {
  try {
    const email = String(req.query.email || "").trim().toLowerCase();
    const token = String(req.query.token || "").trim();

    if (!email || !token) {
      return res.status(400).json({ ok: false, error: "email/token required" });
    }

    const tokenHash = sha256Hex(token);

    const user = await User.findOne({
      email,
      emailVerifyTokenHash: tokenHash,
      emailVerifyTokenExpiresAt: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({
        ok: false,
        code: "INVALID_OR_EXPIRED",
        error: "Invalid or expired token",
      });
    }

    user.emailVerified = true;
    user.emailVerifiedAt = new Date();
    user.emailVerifyTokenHash = undefined;
    user.emailVerifyTokenExpiresAt = undefined;
    await user.save();

    return res.json({ ok: true });
  } catch (e) {
    console.error("[verify-email error]", e);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * POST /auth/resend-verification
 * Body: { email }
 */
router.post("/resend-verification", async (req, res) => {
  try {
    const emailV = validateEmail(req.body?.email);
    if (!emailV.ok) return res.status(400).json({ ok: false, error: emailV.error });
    const email = emailV.value;

    const user = await User.findOne({ email });
    if (!user) return res.json({ ok: true });
    if (user.emailVerified) return res.json({ ok: true });

    const lastSent = user.emailVerifyLastSentAt ? new Date(user.emailVerifyLastSentAt).getTime() : 0;
    if (Date.now() - lastSent < RESEND_COOLDOWN_MS) {
      return res.status(429).json({ ok: false, code: "TOO_SOON", error: "Please wait before resending." });
    }

    await issueAndSendVerifyEmail(user);
    return res.json({ ok: true });
  } catch (e) {
    console.error("[resend-verification error]", e);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * POST /auth/forgot-password
 * Body: { email }
 * No session required. Always returns ok:true to avoid account enumeration.
 */
router.post("/forgot-password", async (req, res) => {
  try {
    const emailV = validateEmail(req.body?.email);
    if (!emailV.ok) return res.status(400).json({ ok: false, error: emailV.error });
    const email = emailV.value;

    const user = await User.findOne({ email });
    if (!user) return res.json({ ok: true });

    const lastSent = user.passwordResetLastSentAt ? new Date(user.passwordResetLastSentAt).getTime() : 0;
    if (Date.now() - lastSent < PW_RESET_COOLDOWN_MS) {
      // still return ok:true to avoid signaling existence/frequency
      return res.json({ ok: true });
    }

    await issueAndSendPasswordResetEmail(user);
    return res.json({ ok: true });
  } catch (e) {
    console.error("[forgot-password error]", e);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * POST /auth/reset-password
 * Body: { email, token, newPassword }
 * No session required.
 */
router.post("/reset-password", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const token = String(req.body?.token || "").trim();
    const newPassword = req.body?.newPassword;

    if (!email || !token || !newPassword) {
      return res.status(400).json({ ok: false, error: "email/token/newPassword required" });
    }
    if (!emailRegex.test(email) || email.length > 254) {
      return res.status(400).json({ ok: false, error: "invalid email" });
    }

    const tokenHash = sha256Hex(token);

    const user = await User.findOne({
      email,
      passwordResetTokenHash: tokenHash,
      passwordResetTokenExpiresAt: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ ok: false, code: "INVALID_OR_EXPIRED", error: "Invalid or expired token" });
    }

    const userInputs = getPwUserInputs({
      username: user.username,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    });

    const pwV = validatePassword(newPassword, userInputs);
    if (!pwV.ok) {
      return res.status(400).json({
        ok: false,
        error: pwV.error,
        code: pwV.code,
        score: pwV.score,
        feedback: pwV.feedback,
      });
    }

    const hash = await bcrypt.hash(String(newPassword), 10);
    user.password = hash;

    user.passwordResetTokenHash = undefined;
    user.passwordResetTokenExpiresAt = undefined;
    user.passwordResetLastSentAt = undefined;

    await user.save();

    return res.json({ ok: true });
  } catch (e) {
    console.error("[reset-password error]", e);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * POST /auth/login
 * Block login until verified
 */
router.post("/login", async (req, res) => {
  try {
    let { identifier, email, password } = req.body || {};
    const loginId = (identifier || email || "").trim().toLowerCase();

    if (!loginId || !password) {
      return res.status(400).json({ ok: false, error: "id/email and password required" });
    }

    const query = loginId.includes("@") ? { email: loginId } : { username: loginId };

    const user = await User.findOne(query);
    if (!user) return res.status(401).json({ ok: false, error: "Invalid credentials" });

    const valid = await bcrypt.compare(String(password), user.password);
    if (!valid) return res.status(401).json({ ok: false, error: "Invalid credentials" });

    if (!user.emailVerified) {
      return res.status(403).json({
        ok: false,
        code: "EMAIL_NOT_VERIFIED",
        error: "Please verify your email before logging in.",
        email: user.email,
      });
    }

    req.session.userId = user._id.toString();

    return res.json({
      ok: true,
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        emailVerified: user.emailVerified,
      },
    });
  } catch (e) {
    console.error("[login error]", e);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * GET /auth/me
 */
router.get("/me", async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  try {
    const user = await User.findById(req.session.userId).select(
      "_id email username firstName lastName role createdAt emailVerified emailVerifiedAt"
    );

    if (!user) return res.status(404).json({ ok: false, error: "User not found" });

    return res.json({ ok: true, user });
  } catch (e) {
    console.error("[me error]", e);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * POST /auth/logout
 */
router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

/**
 * POST /auth/change-password
 * Logged-in users only (session required)
 */
router.post("/change-password", async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ ok: false, error: "current/new password required" });
    }

    const user = await User.findById(req.session.userId);
    if (!user) return res.status(404).json({ ok: false, error: "User not found" });

    const valid = await bcrypt.compare(String(currentPassword), user.password);
    if (!valid) return res.status(401).json({ ok: false, error: "Current password is incorrect" });

    const sameAsOld = await bcrypt.compare(String(newPassword), user.password);
    if (sameAsOld) return res.status(400).json({ ok: false, error: "New password must be different" });

    const userInputs = getPwUserInputs({
      username: user.username,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    });

    const pwV = validatePassword(newPassword, userInputs);
    if (!pwV.ok) {
      return res.status(400).json({
        ok: false,
        error: pwV.error,
        code: pwV.code,
        score: pwV.score,
        feedback: pwV.feedback,
      });
    }

    const hash = await bcrypt.hash(String(newPassword), 10);
    user.password = hash;
    await user.save();

    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      return res.json({ ok: true });
    });
  } catch (e) {
    console.error("[change-password error]", e);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

module.exports = router;