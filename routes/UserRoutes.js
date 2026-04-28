const express = require("express");
const User = require("../models/User");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

const MAX_NAME_LEN = 20;
const PROFILE_NAME_FIELDS = [
  { key: "firstName", label: "firstName" },
  { key: "lastName", label: "lastName" },
];

const normalizeSpaces = (value) => String(value || "").replace(/\s+/g, " ").trim();

const validateProfileName = (value, label) => {
  if (typeof value !== "string") return { ok: false, error: `${label} must be a string` };

  const normalized = normalizeSpaces(value);
  if (!normalized) return { ok: false, error: `${label} required` };
  if (normalized.length > MAX_NAME_LEN) return { ok: false, error: `${label} too long` };

  return { ok: true, value: normalized };
};

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

    for (const { key, label } of PROFILE_NAME_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue;

      const validated = validateProfileName(body[key], label);
      if (!validated.ok) return res.status(400).json({ ok: false, error: validated.error });

      updates[key] = validated.value;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ ok: false, error: "No valid profile fields provided" });
    }

    const user = await User.findByIdAndUpdate(req.session.userId, updates, {
      new: true,
      runValidators: true,
      select: "_id email username firstName lastName role createdAt emailVerified emailVerifiedAt",
    });

    if (!user) return res.status(404).json({ ok: false, error: "User not found" });

    return res.json({ ok: true, user });
  } catch (e) {
    console.error("[users patch error]", e);
    if (e?.name === "ValidationError") {
      return res.status(400).json({ ok: false, error: "Invalid profile update" });
    }
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

module.exports = router;
