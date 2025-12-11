const express = require("express");
const Community = require("../models/Community");
const CommunityMembership = require("../models/CommunityMembership");
const User = require("../models/User");
const requireAuth = require("../middleware/requireAuth");
const createNotification = require("../utils/createNotifications");
const CommunityPost = require("../models/CommunityPost");

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

// GET /community/:id
// Detailed community view for CommunityInfo page
router.get("/:id", async (req, res) => {
  try {
    const { id: communityId } = req.params;

    const community = await Community.findById(communityId)
      .populate("owner", "username firstName lastName")
      .exec();

    if (!community) {
      return res.status(404).json({ ok: false, error: "Community not found" });
    }

    // Get all memberships for this community
    const memberships = await CommunityMembership.find({
      community: communityId,
    })
      .populate("user", "username firstName lastName")
      .exec();

    const toUserSummary = (userDoc) => {
      if (!userDoc) return null;
      const fullName = [userDoc.firstName, userDoc.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();
      return {
        id: userDoc._id,
        username: userDoc.username || fullName || "Unknown",
        fullName: fullName || null,
      };
    };

    const ownerSummary = community.owner ? toUserSummary(community.owner) : null;
    const leaderMemberships = memberships.filter(
      (m) => m.role === "Leader" && m.user
    );
    const leaders = leaderMemberships
      .map((m) => toUserSummary(m.user))
      .filter(Boolean);

    // Members list (everyone except Owner)
    const memberSummaries = memberships
      .filter((m) => m.user)
      .map((m) => ({
        ...toUserSummary(m.user),
        role: m.role,
      }));

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
        owner: ownerSummary,
        leaders,
        members: memberSummaries,
      },
    });
  } catch (err) {
    console.error("[get community detail error]", err);
    return res
      .status(500)
      .json({ ok: false, error: "Internal server error" });
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

const mapTypeToClass = (type) => {
  switch (type) {
    case "questions":
      return "questions";
    case "announcements":
      return "announcements";
    case "poll":
      return "poll";
    default:
      return "general";
  }
};


const toSubtitle = (body) => {
  if (!body) return "";
  const trimmed = body.trim();
  if (trimmed.length <= 140) return trimmed;
  return trimmed.slice(0, 137) + "...";
};

/**
 * GET /community/:id/posts
 * List posts for a specific community
 */
router.get("/:id/posts", async (req, res) => {
  try {
    const { id: communityId } = req.params;

    const community = await Community.findById(communityId).exec();
    if (!community) {
      return res.status(404).json({ ok: false, error: "Community not found" });
    }

    const posts = await CommunityPost.find({ community: communityId })
      .sort({ createdAt: -1 })
      .populate("author", "username firstName lastName")
      .exec();

    const result = posts.map((p) => {
      const fullName = p.author
        ? [p.author.firstName, p.author.lastName].filter(Boolean).join(" ")
        : null;

      return {
        id: p._id,
        title: p.title,
        subtitle: toSubtitle(p.body),
        category:
          p.type === "questions"
            ? "Questions"
            : p.type === "announcements"
              ? "Announcements"
              : p.type === "poll"
                ? "Poll"
                : "General",
        categoryClass: mapTypeToClass(p.type),
        replyCount: p.replyCount || 0,
        activityText: p.updatedAt || p.createdAt,
        author: fullName || p.author?.username || "Unknown",
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      };
    });

    return res.json({ ok: true, posts: result });
  } catch (err) {
    console.error("[get community posts error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * POST /community/:id/posts
 * Create a new post in a community (must be a member)
 */
router.post("/:id/posts", requireAuth, async (req, res) => {
  try {
    const { id: communityId } = req.params;
    const userId = req.session.userId;
    const { title, body, type } = req.body || {};

    if (!title || (!body && normalizedType !== "poll")) {
      return res
        .status(400)
        .json({ ok: false, error: "Title and body are required." });
    }

    const community = await Community.findById(communityId).exec();
    if (!community) {
      return res.status(404).json({ ok: false, error: "Community not found" });
    }

    const membership = await CommunityMembership.findOne({
      user: userId,
      community: communityId,
    }).exec();

    if (!membership) {
      return res.status(403).json({
        ok: false,
        error: "You must join this community before posting.",
      });
    }

    const normalizedType =
      ["general", "questions", "announcements", "poll"].includes(
        (type || "").toLowerCase()
      )
        ? type.toLowerCase()
        : "general";

    const pollConfig = req.body.poll;

    const post = await CommunityPost.create({
      community: communityId,
      author: userId,
      title,
      body: body || "",
      type: normalizedType,
      ...(normalizedType === "poll" && pollConfig
        ? {
          poll: {
            options: (pollConfig.options || [])
              .map((text) => ({ text: String(text).trim() }))
              .filter((o) => o.text),
            allowMultiple: !!pollConfig.allowMultiple,
            anonymous: pollConfig.anonymous !== false, // default true
          },
        }
        : {}),
    });


    // update community lastActivityAt
    community.lastActivityAt = new Date();
    await community.save();

    const responsePost = {
      id: post._id,
      title: post.title,
      subtitle: body.length > 140 ? body.slice(0, 137) + "..." : body,
      category:
        normalizedType === "questions"
          ? "Questions"
          : normalizedType === "announcements"
            ? "Announcements"
            : normalizedType === "poll"
              ? "Poll"
              : "General",
      categoryClass: mapTypeToClass(normalizedType),
      replyCount: 0,
      activityText: post.createdAt,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
    };


    // --- Notify Owner & Leaders about new post ---
    try {
      const memberships = await CommunityMembership.find({
        community: communityId,
      })
        .populate("user", "firstName lastName")
        .exec();

      const author = memberships.find(
        (m) => String(m.user?._id) === String(userId)
      );

      const authorName = author?.user
        ? [author.user.firstName, author.user.lastName]
          .filter(Boolean)
          .join(" ")
        : "A member";

      const message = `${authorName} posted “${post.title}” in ${community.header}.`;

      const recipients = memberships
        .filter(
          (m) =>
            ["Owner", "Leader"].includes(m.role) &&
            String(m.user?._id) !== String(userId)
        )
        .map((m) => m.user?._id)
        .filter(Boolean);

      const uniqueRecipientIds = [...new Set(recipients.map(String))];

      for (const uid of uniqueRecipientIds) {
        await createNotification({
          user: uid,
          type: "COMMUNITY_NEW_POST",
          message,
          community: community._id,
          actor: userId,
          post: post._id,
        });
      }
    } catch (notifyErr) {
      console.error("[create community post notification error]", notifyErr);
      // don't fail the request just because notifications failed
    }

    return res.status(201).json({ ok: true, post: responsePost });
  } catch (err) {
    console.error("[create community post error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});




module.exports = router;
