// routes/userRoutes.js
const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");

const router = express.Router();

/**
 * POST /auth/signup
 * Create account with email + username + password
 * Does NOT auto-login (no session set) so user must log in afterward.
 */
router.post("/signup", async (req, res) => {
  try {
    let { firstName, lastName, email, username, password } = req.body || {};

    if (!firstName || !lastName) {
      return res.status(400).json({ ok: false, error: "name required" });
    }
    if (!email || !password || !username) {
      return res
        .status(400)
        .json({ ok: false, error: "email/username/password required" });
    }

    email = email.trim().toLowerCase();
    username = username.trim().toLowerCase();

    console.log("[signup payload]", { firstName, lastName, email, username });

    // Check duplicates for email OR username
    const exists = await User.findOne({
      $or: [{ email }, { username }],
    });

    if (exists) {
      if (exists.email === email) {
        return res
          .status(409)
          .json({ ok: false, error: "Email already registered" });
      }
      if (exists.username === username) {
        return res
          .status(409)
          .json({ ok: false, error: "Username already taken" });
      }
      return res
        .status(409)
        .json({ ok: false, error: "Account already exists" });
    }

    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({
      firstName,
      lastName,
      email,
      username,
      password: hash,
    });

    // 🔹 IMPORTANT: do NOT set req.session.userId here
    // We want the user to log in again after signup.
    // req.session.userId = user._id.toString();

    return res.status(201).json({
      ok: true,
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    });
  } catch (e) {
    console.error("[signup error]", e);
    if (e?.code === 11000) {
      return res
        .status(409)
        .json({ ok: false, error: "Email or username already registered" });
    }
    return res
      .status(500)
      .json({ ok: false, error: "Internal server error" });
  }
});

/**
 * POST /auth/login
 * Accepts either email OR username via "identifier"
 * e.g. { identifier: "jay@example.com", password: "..." }
 *   or { identifier: "jaylee", password: "..." }
 */
router.post("/login", async (req, res) => {
  try {
    let { identifier, email, password } = req.body || {};

    // keep backward compatibility with old `email` clients
    const loginId = (identifier || email || "").trim().toLowerCase();

    if (!loginId || !password) {
      return res
        .status(400)
        .json({ ok: false, error: "id/email and password required" });
    }

    // Decide whether loginId is email or username
    const query = loginId.includes("@")
      ? { email: loginId }
      : { username: loginId };

    const user = await User.findOne(query);
    if (!user) {
      return res
        .status(401)
        .json({ ok: false, error: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res
        .status(401)
        .json({ ok: false, error: "Invalid credentials" });
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
      },
    });
  } catch (e) {
    console.error("[login error]", e);
    return res
      .status(500)
      .json({ ok: false, error: "Internal server error" });
  }
});

/**
 * GET /auth/me
 * Returns current logged-in user based on session
 */
router.get("/me", async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  try {
    const user = await User.findById(req.session.userId).select(
      "_id email username firstName lastName role createdAt"
    );

    if (!user) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    return res.json({ ok: true, user });
  } catch (e) {
    console.error("[me error]", e);
    return res
      .status(500)
      .json({ ok: false, error: "Internal server error" });
  }
});

/**
 * POST /auth/logout
 * Destroys the session and clears cookie
 */
router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

module.exports = router;
