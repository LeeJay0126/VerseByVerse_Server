// routes/userRoutes.js
const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");

const router = express.Router();

// POST /auth/signup
router.post("/signup", async (req, res) => {
  try {
    let { firstName, lastName, email, password } = req.body || {};
    if (!firstName || !lastName) {
      return res.status(400).json({ ok: false, error: "name required" });
    }
    if (!email || !password) {
      return res
        .status(400)
        .json({ ok: false, error: "email/password required" });
    }

    // normalize email
    email = email.trim().toLowerCase();

    console.log("[signup payload]", { firstName, lastName, email });

    const exists = await User.findOne({ email });
    if (exists) {
      return res
        .status(409)
        .json({ ok: false, error: "Email already registered" });
    }

    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({
      firstName,
      lastName,
      email,
      password: hash,
    });

    req.session.userId = user._id.toString();
    return res.status(201).json({
      ok: true,
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    });
  } catch (e) {
    console.error("[signup error]", e);
    if (e?.code === 11000) {
      return res
        .status(409)
        .json({ ok: false, error: "Email already registered" });
    }
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// POST /auth/login
router.post("/login", async (req, res) => {
  try {
    let { email, password } = req.body || {};
    if (!email || !password) {
      return res
        .status(400)
        .json({ ok: false, error: "email/password required" });
    }

    email = email.trim().toLowerCase();

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }

    req.session.userId = user._id.toString();
    return res.json({
      ok: true,
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    });
  } catch (e) {
    console.error("[login error]", e);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// GET /auth/me
router.get("/me", async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  try {
    const user = await User.findById(req.session.userId).select(
      "_id email firstName lastName role createdAt"
    );

    if (!user) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    return res.json({ ok: true, user });
  } catch (e) {
    console.error("[me error]", e);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// POST /auth/logout
router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

/**
 * 🔌 Future: find password / reset password endpoints
 * e.g.
 * router.post("/forgot-password", ...)
 * router.post("/reset-password", ...)
 */

module.exports = router;
