const express = require("express");
const Community = require("../models/Community");
const CommunityMembership = require("../models/CommunityMembership");
const User = require("../models/User");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const requireAuth = require("../middleware/requireAuth");
const createNotification = require("../utils/createNotifications");
const CommunityPost = require("../models/CommunityPost");
const CommunityReply = require("../models/CommunityReply");
const CommunityPollVote = require("../models/CommunityPollVote");

const router = express.Router();

const heroUploadDir = path.join(__dirname, "..", "uploads", "community-heroes");
if (!fs.existsSync(heroUploadDir)) {
  fs.mkdirSync(heroUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, heroUploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".png";
    const filename = `community-${req.params.id}-${Date.now()}${ext}`;
    cb(null, filename);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  },
});

const bumpCommunityActivity = async (communityId) => {
  if (!communityId) return;
  await Community.updateOne(
    { _id: communityId },
    { $set: { lastActivityAt: new Date() } }
  );
};

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
      const myMemberships = await CommunityMembership.find({ user: userId })
        .select("community")
        .lean();

      const myCommunityIds = myMemberships.map((m) => m.community);
      if (myCommunityIds.length) {
        filter._id = { $nin: myCommunityIds };
      }
    }

    const communities = await Community.find(filter)
      .sort({ lastActivityAt: -1 })
      .limit(50)
      .exec();

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

    const community = await Community.findById(communityId)
      .populate("owner", "username firstName lastName")
      .exec();

    if (!community) {
      return res.status(404).json({ ok: false, error: "Community not found" });
    }

    const memberships = await CommunityMembership.find({ community: communityId })
      .populate("user", "username firstName lastName")
      .exec();

    const toUserSummary = (userDoc) => {
      if (!userDoc) return null;
      const fullName = [userDoc.firstName, userDoc.lastName].filter(Boolean).join(" ").trim();
      return {
        id: userDoc._id,
        username: userDoc.username || fullName || "Unknown",
        fullName: fullName || null,
      };
    };

    const ownerSummary = community.owner ? toUserSummary(community.owner) : null;

    const leaderMemberships = memberships.filter((m) => m.role === "Leader" && m.user);
    const leaders = leaderMemberships.map((m) => toUserSummary(m.user)).filter(Boolean);

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
    if (!community) {
      return res.status(404).json({ ok: false, error: "Community not found" });
    }

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

    const inviter = await User.findById(inviterId).select("firstName lastName").exec();
    const invitee = await User.findById(inviteeId).select("firstName lastName email").exec();

    if (!invitee) {
      return res.status(404).json({ ok: false, error: "User to invite not found" });
    }

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
    if (!community) {
      return res.status(404).json({ ok: false, error: "Community not found" });
    }

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

router.get("/:id/posts", requireAuth, async (req, res) => {
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
      const fullName = p.author ? [p.author.firstName, p.author.lastName].filter(Boolean).join(" ") : null;

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

router.post("/:id/posts", requireAuth, async (req, res) => {
  try {
    const { id: communityId } = req.params;
    const userId = req.session.userId;
    const { title, body, type } = req.body || {};

    const normalizedType = ["general", "questions", "announcements", "poll"].includes((type || "").toLowerCase())
      ? type.toLowerCase()
      : "general";

    if (!title || (!body && normalizedType !== "poll")) {
      return res.status(400).json({ ok: false, error: "Title and body are required." });
    }

    const community = await Community.findById(communityId).exec();
    if (!community) {
      return res.status(404).json({ ok: false, error: "Community not found" });
    }

    const membership = await CommunityMembership.findOne({ user: userId, community: communityId }).exec();
    if (!membership) {
      return res.status(403).json({
        ok: false,
        error: "You must join this community before posting.",
      });
    }

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
              anonymous: pollConfig.anonymous !== false,
            },
          }
        : {}),
    });

    await bumpCommunityActivity(communityId);

    const safeBody = body || "";

    const responsePost = {
      id: post._id,
      title: post.title,
      subtitle: safeBody.length > 140 ? safeBody.slice(0, 137) + "..." : safeBody,
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

    try {
      const memberships = await CommunityMembership.find({ community: communityId })
        .populate("user", "firstName lastName")
        .exec();

      const author = memberships.find((m) => String(m.user?._id) === String(userId));

      const authorName = author?.user
        ? [author.user.firstName, author.user.lastName].filter(Boolean).join(" ")
        : "A member";

      const message = `${authorName} posted “${post.title}” in ${community.header}.`;

      const recipients = memberships
        .filter((m) => ["Owner", "Leader"].includes(m.role) && String(m.user?._id) !== String(userId))
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
    }

    return res.status(201).json({ ok: true, post: responsePost });
  } catch (err) {
    console.error("[create community post error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.post("/:id/hero-image", requireAuth, upload.single("heroImage"), async (req, res) => {
  try {
    const { id: communityId } = req.params;
    const userId = req.session.userId;

    const community = await Community.findById(communityId).exec();
    if (!community) {
      return res.status(404).json({ ok: false, error: "Community not found" });
    }

    const membership = await CommunityMembership.findOne({ user: userId, community: communityId }).exec();
    if (!membership || !["Owner", "Leader"].includes(membership.role)) {
      return res.status(403).json({
        ok: false,
        error: "You do not have permission to update this hero image.",
      });
    }

    if (!req.file) {
      return res.status(400).json({ ok: false, error: "No file uploaded." });
    }

    const relativePath = `/uploads/community-heroes/${req.file.filename}`;
    community.heroImageUrl = relativePath;
    await community.save();

    return res.json({ ok: true, heroImageUrl: relativePath });
  } catch (err) {
    console.error("[update community hero image error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.get("/:id/posts/:postId", requireAuth, async (req, res) => {
  try {
    const { id: communityId, postId } = req.params;
    const userId = req.session.userId;

    const community = await Community.findById(communityId).exec();
    if (!community) {
      return res.status(404).json({ ok: false, error: "Community not found" });
    }

    const post = await CommunityPost.findOne({ _id: postId, community: communityId })
      .populate("author", "username firstName lastName")
      .exec();

    if (!post) {
      return res.status(404).json({ ok: false, error: "Post not found" });
    }

    const fullName = post.author ? [post.author.firstName, post.author.lastName].filter(Boolean).join(" ") : null;

    let poll = null;
    let pollResults = null;
    let myVotes = [];

    if (post.type === "poll" && post.poll && post.poll.options.length) {
      const votes = await CommunityPollVote.find({ post: post._id }).exec();

      const counts = Array(post.poll.options.length).fill(0);
      votes.forEach((v) => {
        if (v.optionIndex >= 0 && v.optionIndex < counts.length) counts[v.optionIndex]++;
      });

      const totalVotes = counts.reduce((a, b) => a + b, 0);

      poll = {
        options: post.poll.options.map((opt) => ({ text: opt.text })),
        allowMultiple: post.poll.allowMultiple,
        anonymous: post.poll.anonymous,
      };

      pollResults = { counts, totalVotes };

      myVotes = votes
        .filter((v) => String(v.user) === String(userId))
        .map((v) => v.optionIndex);
    }

    const responsePost = {
      id: post._id,
      title: post.title,
      body: post.body,
      type: post.type,
      replyCount: post.replyCount || 0,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      author: fullName || post.author?.username || "Unknown",
      poll,
      pollResults,
      myVotes,
    };

    return res.json({
      ok: true,
      post: responsePost,
      community: {
        id: community._id,
        header: community.header,
        subheader: community.subheader,
      },
    });
  } catch (err) {
    console.error("[get community post detail error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.post("/:id/posts/:postId/vote", requireAuth, async (req, res) => {
  try {
    const { id: communityId, postId } = req.params;
    const userId = req.session.userId;
    const { optionIndex } = req.body;

    if (typeof optionIndex !== "number") {
      return res.status(400).json({ ok: false, error: "optionIndex is required." });
    }

    const community = await Community.findById(communityId).exec();
    if (!community) {
      return res.status(404).json({ ok: false, error: "Community not found" });
    }

    const post = await CommunityPost.findOne({ _id: postId, community: communityId }).exec();
    if (!post || post.type !== "poll" || !post.poll) {
      return res.status(400).json({ ok: false, error: "This post is not a poll." });
    }

    if (optionIndex < 0 || optionIndex >= post.poll.options.length) {
      return res.status(400).json({ ok: false, error: "Invalid poll option." });
    }

    const membership = await CommunityMembership.findOne({ user: userId, community: communityId }).exec();
    if (!membership) {
      return res.status(403).json({
        ok: false,
        error: "You must join this community to participate in polls.",
      });
    }

    const existing = await CommunityPollVote.findOne({ post: post._id, user: userId, optionIndex }).exec();

    if (existing) {
      await CommunityPollVote.deleteOne({ _id: existing._id });
      await bumpCommunityActivity(communityId);

      const votes = await CommunityPollVote.find({ post: post._id }).exec();
      const counts = Array(post.poll.options.length).fill(0);
      votes.forEach((v) => {
        if (v.optionIndex >= 0 && v.optionIndex < counts.length) counts[v.optionIndex]++;
      });

      const totalVotes = counts.reduce((a, b) => a + b, 0);
      const myVotes = votes.filter((v) => String(v.user) === String(userId)).map((v) => v.optionIndex);

      return res.json({ ok: true, pollResults: { counts, totalVotes }, myVotes });
    }

    if (!post.poll.allowMultiple) {
      await CommunityPollVote.deleteMany({ post: post._id, user: userId });
    }

    await CommunityPollVote.create({ post: post._id, user: userId, optionIndex });

    await bumpCommunityActivity(communityId);

    const votes = await CommunityPollVote.find({ post: post._id }).exec();
    const counts = Array(post.poll.options.length).fill(0);
    votes.forEach((v) => {
      if (v.optionIndex >= 0 && v.optionIndex < counts.length) counts[v.optionIndex]++;
    });

    const totalVotes = counts.reduce((a, b) => a + b, 0);
    const myVotes = votes.filter((v) => String(v.user) === String(userId)).map((v) => v.optionIndex);

    return res.json({ ok: true, pollResults: { counts, totalVotes }, myVotes });
  } catch (err) {
    console.error("[poll vote error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.get("/:id/posts/:postId/replies", requireAuth, async (req, res) => {
  try {
    const { id: communityId, postId } = req.params;

    const post = await CommunityPost.findOne({ _id: postId, community: communityId }).exec();
    if (!post) {
      return res.status(404).json({ ok: false, error: "Post not found" });
    }

    const replies = await CommunityReply.find({ post: post._id })
      .sort({ createdAt: 1 })
      .populate("author", "username firstName lastName")
      .exec();

    const result = replies.map((r) => {
      const fullName = r.author ? [r.author.firstName, r.author.lastName].filter(Boolean).join(" ") : null;
      return {
        id: r._id,
        body: r.body,
        author: fullName || r.author?.username || "Unknown",
        createdAt: r.createdAt,
        parentReplyId: r.parentReply ? String(r.parentReply) : null,
      };
    });

    return res.json({ ok: true, replies: result });
  } catch (err) {
    console.error("[get post replies error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.post("/:id/posts/:postId/replies", requireAuth, async (req, res) => {
  try {
    const { id: communityId, postId } = req.params;
    const userId = req.session.userId;
    const { body, parentReplyId } = req.body || {};

    if (!body || !body.trim()) {
      return res.status(400).json({ ok: false, error: "Reply body is required." });
    }

    const post = await CommunityPost.findOne({ _id: postId, community: communityId }).exec();
    if (!post) {
      return res.status(404).json({ ok: false, error: "Post not found" });
    }

    const membership = await CommunityMembership.findOne({ user: userId, community: communityId }).exec();
    if (!membership) {
      return res.status(403).json({
        ok: false,
        error: "You must join this community before replying.",
      });
    }

    let parentReply = null;

    if (parentReplyId) {
      parentReply = await CommunityReply.findOne({ _id: parentReplyId, post: post._id }).exec();
      if (!parentReply) {
        return res.status(400).json({ ok: false, error: "Invalid parent reply." });
      }
    }

    const reply = await CommunityReply.create({
      post: post._id,
      parentReply: parentReply ? parentReply._id : null,
      author: userId,
      body: body.trim(),
    });

    post.replyCount = (post.replyCount || 0) + 1;
    post.lastReplyAt = reply.createdAt;
    await post.save();

    await bumpCommunityActivity(communityId);

    return res.status(201).json({
      ok: true,
      reply: {
        id: reply._id,
        body: reply.body,
        createdAt: reply.createdAt,
        parentReplyId: reply.parentReply ? String(reply.parentReply) : null,
      },
    });
  } catch (err) {
    console.error("[create post reply error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

module.exports = router;
