// routes/communityRoutes.js
const express = require("express");
const Community = require("../models/Community");
const CommunityMembership = require("../models/CommunityMembership");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

/**
 * POST /community
 * Create a new community (used by CreateCommunity.jsx)
 */
router.post("/", requireAuth, async (req, res) => {
  try {
    const { header, subheader, content, type } = req.body || {};
    const userId = req.session.userId;

    if (!header || !subheader || !content || !type) {
      return res.status(400).json({ ok: false, error: "Missing required fields" });
    }

    const community = await Community.create({
      header,
      subheader,
      content,
      type,
      owner: userId,
      membersCount: 1,
      lastActivityAt: new Date(),
    });

    await CommunityMembership.create({
      user: userId,
      community: community._id,
      role: "Owner",
    });

    return res.status(201).json({
      ok: true,
      community: {
        id: community._id,
        header: community.header,
        subheader: community.subheader,
        content: community.content,
        type: community.type,
        members: community.membersCount,
        lastActivityAt: community.lastActivityAt,
        role: "Owner",
        my: true,
      },
    });
  } catch (err) {
    console.error("[create community error]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /community/my
 * List communities the current user belongs to (My Communities tab)
 */
router.get("/my", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;

    const memberships = await CommunityMembership.find({ user: userId })
      .populate("community")
      .exec();

    const communities = memberships
      .filter((m) => m.community) // safety
      .map((m) => {
        const c = m.community;
        return {
          id: c._id,
          header: c.header,
          subheader: c.subheader,
          content: c.content,
          type: c.type,
          members: c.membersCount,
          lastActivityAt: c.lastActivityAt,
          role: m.role,     // "Owner" / "Leader" / "Member"
          my: true,
        };
      });

    return res.json({ ok: true, communities });
  } catch (err) {
    console.error("[my communities error]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /community/discover
 * Browse communities (used by BrowseCommunity.jsx)
 * Supports optional query params:
 *   q    - search text
 *   type - community type
 *   size - "small" | "medium" | "large"
 */
router.get("/discover", async (req, res) => {
  try {
    const userId = req.session?.userId || null;
    const { q, type, size } = req.query;

    const filter = {};

    if (q) {
      const regex = new RegExp(q.trim(), "i");
      filter.$or = [
        { header: regex },
        { subheader: regex },
        { content: regex },
      ];
    }

    if (type) {
      filter.type = type;
    }

    if (size === "small") {
      filter.membersCount = { $gte: 2, $lte: 10 };
    } else if (size === "medium") {
      filter.membersCount = { $gte: 11, $lte: 30 };
    } else if (size === "large") {
      filter.membersCount = { $gte: 31 };
    }

    const communities = await Community.find(filter)
      .sort({ lastActivityAt: -1 })
      .limit(50)
      .exec();

    // figure out which of these the current user is already in
    let membershipsByCommunity = {};
    if (userId) {
      const memberships = await CommunityMembership.find({
        user: userId,
        community: { $in: communities.map((c) => c._id) },
      }).exec();

      membershipsByCommunity = memberships.reduce((acc, m) => {
        acc[m.community.toString()] = m.role;
        return acc;
      }, {});
    }

    const result = communities.map((c) => {
      const role = membershipsByCommunity[c._id.toString()];
      const isMember = !!role;

      return {
        id: c._id,
        header: c.header,
        subheader: c.subheader,
        content: c.content,
        type: c.type,
        members: c.membersCount,
        lastActivityAt: c.lastActivityAt,
        role: role || null,
        my: isMember,
      };
    });

    return res.json({ ok: true, communities: result });
  } catch (err) {
    console.error("[discover communities error]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
