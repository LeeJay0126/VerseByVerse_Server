const express = require("express");
const Community = require("../models/Community");
const CommunityMembership = require("../models/CommunityMembership");
const User = require("../models/User");
const requireAuth = require("../middleware/requireAuth");
const createNotification = require("../utils/createNotifications");
const uploadCommunityHero = require("../middleware/communityHeroUpload");

const router = express.Router();

const toUserSummary = (userDoc) => {
  if (!userDoc) return null;
  const fullName = [userDoc.firstName, userDoc.lastName].filter(Boolean).join(" ").trim();
  return {
    id: userDoc._id,
    username: userDoc.username || fullName || "Unknown",
    fullName: fullName || null,
  };
};

const escapeRegex = (str) => String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getUserId = (req) => String(req.session?.userId || "");

const isOwner = (community, userId) => {
  const ownerId = String(community?.owner?._id || community?.owner || "");
  return ownerId && ownerId === String(userId);
};

const getMembership = async (userId, communityId) => {
  if (!userId || !communityId) return null;
  return CommunityMembership.findOne({ user: userId, community: communityId }).exec();
};

const canManageMembers = async (userId, community) => {
  if (!userId || !community) return false;
  if (isOwner(community, userId)) return true;

  const membership = await getMembership(userId, community._id);
  if (!membership) return false;

  const leadersAllowed = Boolean(community?.settings?.leadersCanManageMembers);
  return leadersAllowed && membership.role === "Leader";
};

router.post("/", requireAuth(), async (req, res) => {
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
      settings: { leadersCanManageMembers: false },
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

router.get("/my", requireAuth(), async (req, res) => {
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

router.get("/:id", requireAuth(), async (req, res) => {
  try {
    const { id: communityId } = req.params;

    const community = await Community.findById(communityId)
      .populate("owner", "username firstName lastName")
      .exec();

    if (!community) return res.status(404).json({ ok: false, error: "Community not found" });

    const memberships = await CommunityMembership.find({ community: communityId })
      .populate("user", "username firstName lastName")
      .exec();

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
        settings: {
          leadersCanManageMembers: Boolean(community?.settings?.leadersCanManageMembers),
        },
      },
    });
  } catch (err) {
    console.error("[get community detail error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.post("/:id/invite", requireAuth(), async (req, res) => {
  try {
    const { id: communityId } = req.params;
    const { userId: inviteeIdRaw, identifier } = req.body || {};
    const inviterId = req.session.userId;

    const community = await Community.findById(communityId).exec();
    if (!community) return res.status(404).json({ ok: false, error: "Community not found" });

    const inviterMembership = await CommunityMembership.findOne({
      user: inviterId,
      community: communityId,
    }).exec();

    if (!inviterMembership) {
      return res.status(403).json({ ok: false, error: "Not a member of this community" });
    }

    const inviterIsOwner = inviterMembership.role === "Owner";
    const inviterIsLeader = inviterMembership.role === "Leader";
    const leadersAllowed = Boolean(community?.settings?.leadersCanManageMembers);

    if (!inviterIsOwner && !(inviterIsLeader && leadersAllowed)) {
      return res.status(403).json({
        ok: false,
        error: "You do not have permission to invite members to this community",
      });
    }

    let invitee = null;

    if (inviteeIdRaw) {
      invitee = await User.findById(inviteeIdRaw).select("firstName lastName email username").exec();
    } else {
      const ident = String(identifier || "").trim();
      if (!ident) return res.status(400).json({ ok: false, error: "Missing userId or identifier" });

      const isEmail = ident.includes("@");
      if (isEmail) {
        invitee = await User.findOne({ email: new RegExp(`^${escapeRegex(ident)}$`, "i") })
          .select("firstName lastName email username")
          .exec();
      } else {
        invitee = await User.findOne({ username: new RegExp(`^${escapeRegex(ident)}$`, "i") })
          .select("firstName lastName email username")
          .exec();
      }
    }

    if (!invitee) return res.status(404).json({ ok: false, error: "User not found" });

    const existing = await CommunityMembership.findOne({
      user: invitee._id,
      community: communityId,
    })
      .select("_id")
      .exec();

    if (existing) {
      return res.status(400).json({
        ok: false,
        error: "User is already a member of this community",
      });
    }

    const inviter = await User.findById(inviterId).select("firstName lastName username").exec();
    const inviterName =
      (inviter?.username && inviter.username.trim()) ||
      [inviter?.firstName, inviter?.lastName].filter(Boolean).join(" ").trim() ||
      "Someone";

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

router.post("/:id/request-join", requireAuth(), async (req, res) => {
  try {
    const { id: communityId } = req.params;
    const requesterId = req.session.userId;

    const community = await Community.findById(communityId).populate("owner").exec();
    if (!community) return res.status(404).json({ ok: false, error: "Community not found" });

    const requester = await User.findById(requesterId).select("firstName lastName").exec();
    const requesterName = requester ? `${requester.firstName} ${requester.lastName}` : "A user";
    const message = `${requesterName} has requested to join ${community.header}.`;

    await createNotification({
      user: community.owner?._id || community.owner,
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

router.post(
  "/:id/hero-image",
  requireAuth(),
  uploadCommunityHero.single("heroImage"),
  async (req, res) => {
    try {
      const { id: communityId } = req.params;
      const userId = req.session.userId;

      const community = await Community.findById(communityId).exec();
      if (!community) return res.status(404).json({ ok: false, error: "Community not found" });

      const membership = await CommunityMembership.findOne({
        user: userId,
        community: communityId,
      }).exec();

      if (!membership || !["Owner", "Leader"].includes(membership.role)) {
        return res.status(403).json({
          ok: false,
          error: "You do not have permission to update this hero image.",
        });
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
  }
);

router.patch("/:id/members/:userId/role", requireAuth(), async (req, res) => {
  try {
    const { id: communityId, userId: targetUserId } = req.params;
    const userId = getUserId(req);
    const { role } = req.body || {};

    const community = await Community.findById(communityId).exec();
    if (!community) return res.status(404).json({ ok: false, error: "Community not found" });

    if (!isOwner(community, userId)) {
      return res.status(403).json({ ok: false, error: "Only the owner can change roles" });
    }

    if (!["Leader", "Member"].includes(role)) {
      return res.status(400).json({ ok: false, error: "role must be Leader or Member" });
    }

    if (String(targetUserId) === String(community.owner)) {
      return res.status(400).json({ ok: false, error: "Owner role cannot be changed" });
    }

    const membership = await CommunityMembership.findOne({ user: targetUserId, community: communityId }).exec();
    if (!membership) {
      return res.status(404).json({ ok: false, error: "Membership not found" });
    }

    const prevRole = membership.role;
    if (prevRole === role) return res.json({ ok: true });

    membership.role = role;
    await membership.save();

    const ownerUser = await User.findById(userId).select("username firstName lastName").lean().exec();
    const ownerName =
      (ownerUser?.username && ownerUser.username.trim()) ||
      [ownerUser?.firstName, ownerUser?.lastName].filter(Boolean).join(" ").trim() ||
      "The owner";

    const target = { kind: "COMMUNITY_MANAGE", id: community._id };

    if (prevRole !== "Leader" && role === "Leader") {
      const message = `${ownerName} has promoted you to a Leader role in ${community.header}.`;
      await createNotification({
        user: targetUserId,
        type: "COMMUNITY_ROLE_PROMOTION",
        message,
        community: community._id,
        actor: userId,
        target,
      });
    }

    if (prevRole === "Leader" && role === "Member") {
      const message = `${ownerName} has demoted you to a Member role in ${community.header}.`;
      await createNotification({
        user: targetUserId,
        type: "COMMUNITY_ROLE_DEMOTION",
        message,
        community: community._id,
        actor: userId,
        target,
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("[change member role error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.get("/:id/members", requireAuth(), async (req, res) => {
  try {
    const { id: communityId } = req.params;
    const userId = getUserId(req);

    const membership = await CommunityMembership.findOne({ user: userId, community: communityId })
      .select("_id")
      .lean()
      .exec();

    if (!membership) return res.status(403).json({ ok: false, error: "Not a member of this community" });

    const memberships = await CommunityMembership.find({ community: communityId })
      .populate("user", "username firstName lastName email")
      .exec();

    const members = memberships
      .filter((m) => m.user)
      .map((m) => ({
        userId: m.user._id,
        name:
          m.user.username ||
          [m.user.firstName, m.user.lastName].filter(Boolean).join(" ").trim() ||
          "Unknown",
        email: m.user.email || null,
        role: m.role,
      }))
      .sort((a, b) => {
        const order = { Owner: 0, Leader: 1, Member: 2 };
        return (order[a.role] ?? 9) - (order[b.role] ?? 9);
      });

    return res.json({ ok: true, members });
  } catch (err) {
    console.error("[list members error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.get("/:id/join-requests", requireAuth(), async (req, res) => {
  try {
    const { id: communityId } = req.params;
    const userId = getUserId(req);

    const community = await Community.findById(communityId).exec();
    if (!community) return res.status(404).json({ ok: false, error: "Community not found" });

    const canManage = await canManageMembers(userId, community);
    if (!canManage) return res.status(403).json({ ok: false, error: "Forbidden" });

    return res.json({ ok: true, requests: [] });
  } catch (err) {
    console.error("[list join requests error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.post("/:id/join-requests/:userId/accept", requireAuth(), async (req, res) => {
  try {
    const { id: communityId, userId: targetUserId } = req.params;
    const userId = getUserId(req);

    const community = await Community.findById(communityId).exec();
    if (!community) return res.status(404).json({ ok: false, error: "Community not found" });

    const canManage = await canManageMembers(userId, community);
    if (!canManage) return res.status(403).json({ ok: false, error: "Forbidden" });

    const exists = await CommunityMembership.findOne({
      user: targetUserId,
      community: communityId,
    }).exec();

    if (exists) return res.json({ ok: true });

    await CommunityMembership.create({
      user: targetUserId,
      community: communityId,
      role: "Member",
    });

    community.membersCount = Math.max(1, Number(community.membersCount || 1) + 1);
    community.lastActivityAt = new Date();
    await community.save();

    return res.json({ ok: true });
  } catch (err) {
    console.error("[accept join request error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.post("/:id/join-requests/:userId/reject", requireAuth(), async (req, res) => {
  try {
    const { id: communityId } = req.params;
    const userId = getUserId(req);

    const community = await Community.findById(communityId).exec();
    if (!community) return res.status(404).json({ ok: false, error: "Community not found" });

    const canManage = await canManageMembers(userId, community);
    if (!canManage) return res.status(403).json({ ok: false, error: "Forbidden" });

    return res.json({ ok: true });
  } catch (err) {
    console.error("[reject join request error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.delete("/:id/members/:userId", requireAuth(), async (req, res) => {
  try {
    const { id: communityId, userId: targetUserId } = req.params;
    const userId = getUserId(req);

    const community = await Community.findById(communityId).exec();
    if (!community) return res.status(404).json({ ok: false, error: "Community not found" });

    const canManage = await canManageMembers(userId, community);
    if (!canManage) return res.status(403).json({ ok: false, error: "Forbidden" });

    if (String(targetUserId) === String(community.owner)) {
      return res.status(400).json({ ok: false, error: "Cannot expel the owner" });
    }

    const deleted = await CommunityMembership.findOneAndDelete({
      user: targetUserId,
      community: communityId,
    }).exec();

    if (deleted) {
      community.membersCount = Math.max(1, Number(community.membersCount || 1) - 1);
      community.lastActivityAt = new Date();
      await community.save();
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("[expel member error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.patch("/:id/members/:userId/role", requireAuth(), async (req, res) => {
  try {
    const { id: communityId, userId: targetUserId } = req.params;
    const userId = getUserId(req);
    const { role } = req.body || {};

    const community = await Community.findById(communityId).exec();
    if (!community) return res.status(404).json({ ok: false, error: "Community not found" });

    if (!isOwner(community, userId)) {
      return res.status(403).json({ ok: false, error: "Only the owner can change roles" });
    }

    if (!["Leader", "Member"].includes(role)) {
      return res.status(400).json({ ok: false, error: "role must be Leader or Member" });
    }

    if (String(targetUserId) === String(community.owner)) {
      return res.status(400).json({ ok: false, error: "Owner role cannot be changed" });
    }

    const membership = await CommunityMembership.findOne({
      user: targetUserId,
      community: communityId,
    }).exec();

    if (!membership) {
      return res.status(404).json({ ok: false, error: "Membership not found" });
    }

    membership.role = role;
    await membership.save();

    return res.json({ ok: true });
  } catch (err) {
    console.error("[change member role error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.get("/:id/notification-prefs", requireAuth(), async (req, res) => {
  try {
    const { id: communityId } = req.params;
    const userId = getUserId(req);

    const membership = await CommunityMembership.findOne({ user: userId, community: communityId })
      .select("notificationPrefs")
      .lean()
      .exec();

    if (!membership) return res.status(403).json({ ok: false, error: "Not a member of this community" });

    const prefs = membership.notificationPrefs || {};
    return res.json({
      ok: true,
      notificationPrefs: {
        announcements: prefs.announcements !== false,
        bible_study: prefs.bible_study !== false,
        questions: prefs.questions !== false,
        poll: prefs.poll !== false,
      },
    });
  } catch (err) {
    console.error("[get notification prefs error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.patch("/:id/notification-prefs", requireAuth(), async (req, res) => {
  try {
    const { id: communityId } = req.params;
    const userId = getUserId(req);

    const next = req.body || {};
    const allowedKeys = ["announcements", "bible_study", "questions", "poll"];

    const setObj = {};
    for (const k of allowedKeys) {
      if (typeof next[k] === "boolean") {
        setObj[`notificationPrefs.${k}`] = next[k];
      }
    }

    if (!Object.keys(setObj).length) {
      return res.status(400).json({ ok: false, error: "No valid notification prefs provided" });
    }

    const membership = await CommunityMembership.findOneAndUpdate(
      { user: userId, community: communityId },
      { $set: setObj },
      { new: true }
    )
      .select("notificationPrefs")
      .lean()
      .exec();

    if (!membership) return res.status(403).json({ ok: false, error: "Not a member of this community" });

    const prefs = membership.notificationPrefs || {};
    return res.json({
      ok: true,
      notificationPrefs: {
        announcements: prefs.announcements !== false,
        bible_study: prefs.bible_study !== false,
        questions: prefs.questions !== false,
        poll: prefs.poll !== false,
      },
    });
  } catch (err) {
    console.error("[patch notification prefs error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

module.exports = router;