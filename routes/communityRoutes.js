const express = require("express");
const Community = require("../models/Community");
const CommunityMembership = require("../models/CommunityMembership");
const User = require("../models/User");
const requireAuth = require("../middleware/requireAuth");
const createNotification = require("../utils/createNotifications");

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
      return res
        .status(400)
        .json({ ok: false, error: "Missing required fields" });
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
      .filter((m) => m.community)
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
          role: m.role,
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
 */
router.get("/discover", async (req, res) => {
  try {
    const userId = req.session?.userId || null;
    const { q, type, size, lastActive } = req.query;

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

    if (lastActive) {
      const now = new Date();
      let threshold;

      if (lastActive === "7d") {
        threshold = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else if (lastActive === "30d") {
        threshold = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      } else if (lastActive === "90d") {
        threshold = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      }

      if (threshold) {
        filter.lastActivityAt = { $gte: threshold };
      }
    }


    const communities = await Community.find(filter)
      .sort({ lastActivityAt: -1 })
      .limit(50)
      .exec();

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

/**
 * POST /community/:id/invite
 * Body: { userId: "..." }
 * Owner/Leader invites someone
 */
router.post("/:id/invite", requireAuth, async (req, res) => {
  try {
    const { id: communityId } = req.params;
    const { userId: inviteeId } = req.body;
    const inviterId = req.session.userId;

    const community = await Community.findById(communityId).exec();
    if (!community) {
      return res.status(404).json({ ok: false, error: "Community not found" });
    }

    // Check inviter is Owner or Leader in this community
    const inviterMembership = await CommunityMembership.findOne({
      user: inviterId,
      community: communityId,
    }).exec();

    if (!inviterMembership || !["Owner", "Leader"].includes(inviterMembership.role)) {
      return res.status(403).json({
        ok: false,
        error: "You do not have permission to invite members to this community",
      });
    }

    const inviter = await User.findById(inviterId)
      .select("firstName lastName")
      .exec();
    const invitee = await User.findById(inviteeId)
      .select("firstName lastName email")
      .exec();

    if (!invitee) {
      return res
        .status(404)
        .json({ ok: false, error: "User to invite not found" });
    }

    const inviterName = inviter
      ? `${inviter.firstName} ${inviter.lastName}`
      : "Someone";

    const message = `${inviterName} has invited you to join ${community.header}.`;

    await createNotification({
      user: invitee._id,
      type: "COMMUNITY_INVITE",
      message,
      community: community._id,
      actor: inviterId,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("[community invite error]", err);
    return res
      .status(500)
      .json({ ok: false, error: "Internal server error" });
  }
});

/**
 * POST /community/:id/request-join
 * Authenticated user requests to join a community
 */
router.post("/:id/request-join", requireAuth, async (req, res) => {
  try {
    const { id: communityId } = req.params;
    const requesterId = req.session.userId;

    const community = await Community.findById(communityId)
      .populate("owner")
      .exec();
    if (!community) {
      return res.status(404).json({ ok: false, error: "Community not found" });
    }

    const requester = await User.findById(requesterId)
      .select("firstName lastName")
      .exec();
    const requesterName = requester
      ? `${requester.firstName} ${requester.lastName}`
      : "A user";

    const message = `${requesterName} has requested to join ${community.header}.`;

    await createNotification({
      user: community.owner, // receiver (owner)
      type: "COMMUNITY_JOIN_REQUEST",
      message,
      community: community._id,
      actor: requesterId,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("[community join-request error]", err);
    return res
      .status(500)
      .json({ ok: false, error: "Internal server error" });
  }
});

module.exports = router;
