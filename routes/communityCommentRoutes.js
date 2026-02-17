const express = require("express");
const Community = require("../models/Community");
const CommunityMembership = require("../models/CommunityMembership");
const CommunityPost = require("../models/CommunityPost");
const CommunityReply = require("../models/CommunityReply");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

const bumpCommunityActivity = async (communityId) => {
  if (!communityId) return;
  await Community.updateOne({ _id: communityId }, { $set: { lastActivityAt: new Date() } });
};

router.get("/:id/posts/:postId/replies", requireAuth, async (req, res) => {
  try {
    const { id: communityId, postId } = req.params;

    const post = await CommunityPost.findOne({ _id: postId, community: communityId }).exec();
    if (!post) return res.status(404).json({ ok: false, error: "Post not found" });

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
        authorId: r.author?._id ? String(r.author._id) : null,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        parentReplyId: r.parentReply ? String(r.parentReply) : null,
      };
    });

    return res.json({ ok: true, myUserId: req.session.userId, replies: result });
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
    if (!post) return res.status(404).json({ ok: false, error: "Post not found" });

    const membership = await CommunityMembership.findOne({ user: userId, community: communityId }).exec();
    if (!membership) {
      return res.status(403).json({ ok: false, error: "You must join this community before replying." });
    }

    let parentReply = null;
    if (parentReplyId) {
      parentReply = await CommunityReply.findOne({ _id: parentReplyId, post: post._id }).exec();
      if (!parentReply) return res.status(400).json({ ok: false, error: "Invalid parent reply." });
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

    const populated = await CommunityReply.findById(reply._id)
      .populate("author", "username firstName lastName")
      .exec();

    const fullName = populated?.author ? [populated.author.firstName, populated.author.lastName].filter(Boolean).join(" ") : null;

    return res.status(201).json({
      ok: true,
      reply: {
        id: reply._id,
        body: reply.body,
        author: fullName || populated?.author?.username || "Unknown",
        authorId: populated?.author?._id ? String(populated.author._id) : null,
        createdAt: reply.createdAt,
        updatedAt: reply.updatedAt,
        parentReplyId: reply.parentReply ? String(reply.parentReply) : null,
      },
    });
  } catch (err) {
    console.error("[create post reply error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.put("/:id/posts/:postId/replies/:replyId", requireAuth, async (req, res) => {
  try {
    const { id: communityId, postId, replyId } = req.params;
    const userId = req.session.userId;
    const { body } = req.body || {};

    if (!body || !body.trim()) {
      return res.status(400).json({ ok: false, error: "Reply body is required." });
    }

    const post = await CommunityPost.findOne({ _id: postId, community: communityId }).exec();
    if (!post) return res.status(404).json({ ok: false, error: "Post not found" });

    const membership = await CommunityMembership.findOne({ user: userId, community: communityId }).exec();
    if (!membership) {
      return res.status(403).json({ ok: false, error: "You must join this community to edit replies." });
    }

    const reply = await CommunityReply.findOne({ _id: replyId, post: post._id }).exec();
    if (!reply) return res.status(404).json({ ok: false, error: "Reply not found" });

    if (String(reply.author) !== String(userId)) {
      return res.status(403).json({ ok: false, error: "You can only edit your own replies." });
    }

    reply.body = body.trim();
    await reply.save();

    await bumpCommunityActivity(communityId);

    return res.json({
      ok: true,
      reply: {
        id: reply._id,
        body: reply.body,
        updatedAt: reply.updatedAt,
      },
    });
  } catch (err) {
    console.error("[edit reply error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.delete("/:id/posts/:postId/replies/:replyId", requireAuth, async (req, res) => {
  try {
    const { id: communityId, postId, replyId } = req.params;
    const userId = req.session.userId;

    const post = await CommunityPost.findOne({ _id: postId, community: communityId }).exec();
    if (!post) return res.status(404).json({ ok: false, error: "Post not found" });

    const membership = await CommunityMembership.findOne({ user: userId, community: communityId }).exec();
    if (!membership) {
      return res.status(403).json({ ok: false, error: "You must join this community to delete replies." });
    }

    const target = await CommunityReply.findOne({ _id: replyId, post: post._id }).exec();
    if (!target) return res.status(404).json({ ok: false, error: "Reply not found" });

    if (String(target.author) !== String(userId)) {
      return res.status(403).json({ ok: false, error: "You can only delete your own replies." });
    }

    const all = await CommunityReply.find({ post: post._id }).select("_id parentReply createdAt").lean();

    const byParent = new Map();
    for (const r of all) {
      const p = r.parentReply ? String(r.parentReply) : "root";
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p).push(String(r._id));
    }

    const toDelete = new Set();
    const stack = [String(replyId)];
    while (stack.length) {
      const cur = stack.pop();
      if (toDelete.has(cur)) continue;
      toDelete.add(cur);
      const kids = byParent.get(cur) || [];
      for (const k of kids) stack.push(k);
    }

    const deleteIds = [...toDelete];
    const deletedCount = deleteIds.length;

    await CommunityReply.deleteMany({ _id: { $in: deleteIds }, post: post._id });

    const remaining = await CommunityReply.find({ post: post._id }).sort({ createdAt: -1 }).limit(1).lean();
    const last = remaining[0] || null;

    post.replyCount = Math.max(0, (post.replyCount || 0) - deletedCount);
    post.lastReplyAt = last ? last.createdAt : null;
    await post.save();

    await bumpCommunityActivity(communityId);

    return res.json({ ok: true, deletedCount });
  } catch (err) {
    console.error("[delete reply error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

module.exports = router;
