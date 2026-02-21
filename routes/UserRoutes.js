const express = require("express");
const User = require("../models/User");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

/**
 * GET /users/me
 * Returns user profile (requires session + verified email by default)
 */
router.get("/me", requireAuth({ requireVerified: true }), async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).select(
      "_id email username firstName lastName role createdAt emailVerified emailVerifiedAt"
    );

    if (!user) return res.status(404).json({ ok: false, error: "User not found" });

    return res.json({ ok: true, user });
  } catch (e) {
    console.error("[users/me error]", e);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * PATCH /users/me
 * Update basic profile fields (requires verified)
 */
router.patch("/me", requireAuth({ requireVerified: true }), async (req, res) => {
  try {
    const body = req.body || {};
    const updates = {};

    if (typeof body.firstName === "string") updates.firstName = body.firstName.trim();
    if (typeof body.lastName === "string") updates.lastName = body.lastName.trim();

    const user = await User.findByIdAndUpdate(req.session.userId, updates, {
      new: true,
      runValidators: true,
      select: "_id email username firstName lastName role createdAt emailVerified emailVerifiedAt",
    });

    if (!user) return res.status(404).json({ ok: false, error: "User not found" });

    return res.json({ ok: true, user });
  } catch (e) {
    console.error("[users patch error]", e);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

module.exports = router;