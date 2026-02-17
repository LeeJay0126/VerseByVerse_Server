const express = require("express");
const Community = require("../models/Community");
const CommunityMembership = require("../models/CommunityMembership");
const User = require("../models/User");
const requireAuth = require("../middleware/requireAuth");
const createNotification = require("../utils/createNotifications");
const uploadCommunityHero = require("../middleware/communityHeroUpload");

const router = express.Router();

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

router.get("/my", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;

    const memberships = await CommunityMembership.find({ user: userId }).populate("community").exec();

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
      })
      .sort((a, b) => new Date(b.lastActivityAt) - new Date(a.lastActivityAt));

    return res.json({ ok: true, communities });
  } catch (err) {
    console.error("[my communities error]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/discover", async (req, res) => {
  try {
    const userId = req.session?.userId || null;
    const { q, type, size, lastActive } = req.query;

    const filter = {};

    if (q) {
      const regex = new RegExp(q.trim(), "i");
      filter.$or = [{ header: regex }, { subheader: regex }, { content: regex }];
    }

    if (type) filter.type = type;

    if (size === "small") filter.membersCount = { $gte: 2, $lte: 10 };
    else if (size === "medium") filter.membersCount = { $gte: 11, $lte: 30 };
    else if (size === "large") filter.membersCount = { $gte: 31 };

    if (lastActive) {
      const now = new Date();
      let threshold = null;

      if (lastActive === "7d") threshold = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      if (lastActive === "30d") threshold = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      if (lastActive === "90d") threshold = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

      if (threshold) filter.lastActivityAt = { $gte: threshold };
    }

    if (userId) {
      const myMemberships = await CommunityMembership.find({ user: userId }).select("community").lean();
      const myCommunityIds = myMemberships.map((m) => m.community);
      if (myCommunityIds.length) filter._id = { $nin: myCommunityIds };
    }

    const communities = await Community.find(filter).sort({ lastActivityAt: -1 }).limit(50).exec();

    const result = communities.map((c) => ({
      id: c._id,
      header: c.header,
      subheader: c.subheader,
      content: c.content,
      type: c.type,
      members: c.membersCount,
      lastActivityAt: c.lastActivityAt,
      role: null,
      my: false,
    }));

    return res.json({ ok: true, communities: result });
  } catch (err) {
    console.error("[discover communities error]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { id: communityId } = req.params;

    const community = await Community.findById(communityId).populate("owner", "username firstName lastName").exec();
    if (!community) return res.status(404).json({ ok: false, error: "Community not found" });

    const memberships = await CommunityMembership.find({ community: communityId })
      .populate("user", "username firstName lastName")
      .exec();

    const toUserSummary = (userDoc) => {
      if (!userDoc) return null;
      const fullName = [userDoc.firstName, userDoc.lastName].filter(Boolean).join(" ").trim();
      return { id: userDoc._id, username: userDoc.username || fullName || "Unknown", fullName: fullName || null };
    };

    const ownerSummary = community.owner ? toUserSummary(community.owner) : null;

    const leaders = memberships
      .filter((m) => m.role === "Leader" && m.user)
      .map((m) => toUserSummary(m.user))
      .filter(Boolean);

    const memberSummaries = memberships
      .filter((m) => m.user)
      .map((m) => ({ ...toUserSummary(m.user), role: m.role }));

    return res.json({
      ok: true,
      community: {
        id: community._id,
        header: community.header,
        subheader: community.subheader,
        content: community.content,
        type: community.type,
        membersCount: community.membersCount,
        lastActivityAt: community.lastActivityAt,
        heroImageUrl: community.heroImageUrl || null,
        owner: ownerSummary,
        leaders,
        members: memberSummaries,
      },
    });
  } catch (err) {
    console.error("[get community detail error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.post("/:id/invite", requireAuth, async (req, res) => {
  try {
    const { id: communityId } = req.params;
    const { userId: inviteeId } = req.body;
    const inviterId = req.session.userId;

    const community = await Community.findById(communityId).exec();
    if (!community) return res.status(404).json({ ok: false, error: "Community not found" });

    const inviterMembership = await CommunityMembership.findOne({ user: inviterId, community: communityId }).exec();
    if (!inviterMembership || !["Owner", "Leader"].includes(inviterMembership.role)) {
      return res.status(403).json({ ok: false, error: "You do not have permission to invite members to this community" });
    }

    const inviter = await User.findById(inviterId).select("firstName lastName").exec();
    const invitee = await User.findById(inviteeId).select("firstName lastName email").exec();
    if (!invitee) return res.status(404).json({ ok: false, error: "User to invite not found" });

    const inviterName = inviter ? `${inviter.firstName} ${inviter.lastName}` : "Someone";
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
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.post("/:id/request-join", requireAuth, async (req, res) => {
  try {
    const { id: communityId } = req.params;
    const requesterId = req.session.userId;

    const community = await Community.findById(communityId).populate("owner").exec();
    if (!community) return res.status(404).json({ ok: false, error: "Community not found" });

    const requester = await User.findById(requesterId).select("firstName lastName").exec();
    const requesterName = requester ? `${requester.firstName} ${requester.lastName}` : "A user";
    const message = `${requesterName} has requested to join ${community.header}.`;

    await createNotification({
      user: community.owner,
      type: "COMMUNITY_JOIN_REQUEST",
      message,
      community: community._id,
      actor: requesterId,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("[community join-request error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.post("/:id/hero-image", requireAuth, uploadCommunityHero.single("heroImage"), async (req, res) => {
  try {
    const { id: communityId } = req.params;
    const userId = req.session.userId;

    const community = await Community.findById(communityId).exec();
    if (!community) return res.status(404).json({ ok: false, error: "Community not found" });

    const membership = await CommunityMembership.findOne({ user: userId, community: communityId }).exec();
    if (!membership || !["Owner", "Leader"].includes(membership.role)) {
      return res.status(403).json({ ok: false, error: "You do not have permission to update this hero image." });
    }

    if (!req.file) return res.status(400).json({ ok: false, error: "No file uploaded." });

    const relativePath = `/uploads/community-heroes/${req.file.filename}`;
    community.heroImageUrl = relativePath;
    await community.save();

    return res.json({ ok: true, heroImageUrl: relativePath });
  } catch (err) {
    console.error("[update community hero image error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

module.exports = router;
