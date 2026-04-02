const express = require("express");
const Community = require("../models/Community");
const CommunityMembership = require("../models/CommunityMembership");
const CommunityPost = require("../models/CommunityPost");
const CommunityReply = require("../models/CommunityReply");
const BibleStudySubmission = require("../models/BibleStudySubmission");
const requireAuth = require("../middleware/requireAuth");
const {
  buildStudyShareBody,
  normalizeStudySubmissionAnswers,
  sanitizePagination,
  trimString,
} = require("../utils/bibleStudySubmission");

const router = express.Router();

const bumpCommunityActivity = async (communityId) => {
  if (!communityId) return;
  await Community.updateOne({ _id: communityId }, { $set: { lastActivityAt: new Date() } });
};

const toReplyDto = (reply) => {
  const fullName = reply?.author
    ? [reply.author.firstName, reply.author.lastName].filter(Boolean).join(" ")
    : null;

  return {
    id: reply._id,
    body: reply.body,
    author: fullName || reply.author?.username || "Unknown",
    authorId: reply.author?._id ? String(reply.author._id) : null,
    createdAt: reply.createdAt,
    updatedAt: reply.updatedAt,
    parentReplyId: reply.parentReply ? String(reply.parentReply) : null,
    replyType: reply.studySubmission ? "study_share" : "reply",
    studySubmissionId: reply.studySubmission ? String(reply.studySubmission) : null,
  };
};

const collectDescendantIds = (rootIds, byParent) => {
  const seen = new Set();
  const ordered = [];
  const stack = [...rootIds].reverse();

  while (stack.length) {
    const currentId = stack.pop();
    if (!currentId || seen.has(currentId)) continue;
    seen.add(currentId);
    ordered.push(currentId);

    const children = byParent.get(currentId) || [];
    for (const childId of children) {
      stack.push(childId);
    }
  }

  return ordered;
};

router.get("/:id/posts/:postId/replies", requireAuth(), async (req, res) => {
  try {
    const { id: communityId, postId } = req.params;
    const { page, limit } = sanitizePagination({
      page: req.query.page,
      limit: req.query.limit,
      maxLimit: 20,
    });

    const post = await CommunityPost.findOne({ _id: postId, community: communityId }).exec();
    if (!post) return res.status(404).json({ ok: false, error: "Post not found" });

    const replies = await CommunityReply.find({ post: post._id })
      .sort({ createdAt: 1 })
      .populate("author", "username firstName lastName")
      .exec();

    const dtoReplies = replies.map(toReplyDto);

    const byParent = new Map();
    const rootReplies = [];

    for (const reply of dtoReplies) {
      if (!reply.parentReplyId) {
        rootReplies.push(reply);
        continue;
      }
      if (!byParent.has(reply.parentReplyId)) byParent.set(reply.parentReplyId, []);
      byParent.get(reply.parentReplyId).push(reply.id);
    }

    const totalRootReplies = rootReplies.length;
    const totalPages = Math.max(1, Math.ceil(totalRootReplies / limit));
    const safePage = Math.min(page, totalPages);

    const start = (safePage - 1) * limit;
    const pageRootReplies = rootReplies.slice(start, start + limit);
    const pageRootIds = pageRootReplies.map((reply) => String(reply.id));
    const includedIds = new Set(collectDescendantIds(pageRootIds, byParent));

    const pageReplies = dtoReplies.filter((reply) => includedIds.has(String(reply.id)));

    return res.json({
      ok: true,
      myUserId: req.session.userId,
      replies: pageReplies,
      page: safePage,
      limit,
      totalPages,
      totalRootReplies,
    });
  } catch (err) {
    console.error("[get post replies error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.get("/:id/posts/:postId/study-submissions/me", requireAuth(), async (req, res) => {
  try {
    const { id: communityId, postId } = req.params;
    const userId = req.session.userId;

    const post = await CommunityPost.findOne({ _id: postId, community: communityId }).exec();
    if (!post || post.type !== "bible_study") {
      return res.status(404).json({ ok: false, error: "Bible Study post not found" });
    }

    const membership = await CommunityMembership.findOne({ user: userId, community: communityId }).exec();
    if (!membership) {
      return res.status(403).json({ ok: false, error: "You must join this community first." });
    }

    const submission = await BibleStudySubmission.findOne({
      community: communityId,
      post: postId,
      user: userId,
    }).lean();

    if (!submission) {
      return res.json({ ok: true, submission: null });
    }

    return res.json({
      ok: true,
      submission: {
        id: String(submission._id),
        reflection: submission.reflection || "",
        answers: Array.isArray(submission.answers) ? submission.answers : [],
        updatedAt: submission.updatedAt,
      },
    });
  } catch (err) {
    console.error("[get study submission error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.post("/:id/posts/:postId/study-submissions", requireAuth(), async (req, res) => {
  try {
    const { id: communityId, postId } = req.params;
    const userId = req.session.userId;
    const reflection = trimString(req.body?.reflection);
    const providedAnswers = Array.isArray(req.body?.answers) ? req.body.answers : [];

    const post = await CommunityPost.findOne({ _id: postId, community: communityId }).exec();
    if (!post || post.type !== "bible_study") {
      return res.status(404).json({ ok: false, error: "Bible Study post not found" });
    }

    const membership = await CommunityMembership.findOne({ user: userId, community: communityId }).exec();
    if (!membership) {
      return res.status(403).json({ ok: false, error: "You must join this community before sharing." });
    }

    const questions = Array.isArray(post?.studyContent?.questions)
      ? post.studyContent.questions.map((item) => trimString(item)).filter(Boolean)
      : [];

    const answers = normalizeStudySubmissionAnswers(providedAnswers, questions.length);
    const body = buildStudyShareBody({ reflection, answers, questions });

    if (!body) {
      return res.status(400).json({ ok: false, error: "Please write at least one response before submitting." });
    }

    let submission = await BibleStudySubmission.findOne({
      community: communityId,
      post: postId,
      user: userId,
    }).exec();

    if (!submission) {
      submission = await BibleStudySubmission.create({
        community: communityId,
        post: postId,
        user: userId,
        reflection,
        answers,
      });
    } else {
      submission.reflection = reflection;
      submission.answers = answers;
      await submission.save();
    }

    let reply = await CommunityReply.findOne({
      post: post._id,
      author: userId,
      studySubmission: submission._id,
    }).exec();

    if (!reply) {
      reply = await CommunityReply.create({
        post: post._id,
        parentReply: null,
        author: userId,
        body,
        studySubmission: submission._id,
      });

      post.replyCount = (post.replyCount || 0) + 1;
      post.lastReplyAt = reply.createdAt;
      await post.save();
    } else {
      reply.body = body;
      await reply.save();
    }

    await bumpCommunityActivity(communityId);

    return res.status(201).json({
      ok: true,
      submission: {
        id: String(submission._id),
        reflection: submission.reflection || "",
        answers: Array.isArray(submission.answers) ? submission.answers : [],
        updatedAt: submission.updatedAt,
      },
      reply: {
        id: String(reply._id),
        body: reply.body,
        updatedAt: reply.updatedAt,
      },
    });
  } catch (err) {
    console.error("[create study submission error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.post("/:id/posts/:postId/replies", requireAuth(), async (req, res) => {
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

    return res.status(201).json({
      ok: true,
      reply: toReplyDto(populated),
    });
  } catch (err) {
    console.error("[create post reply error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.put("/:id/posts/:postId/replies/:replyId", requireAuth(), async (req, res) => {
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

    if (reply.studySubmission) {
      return res.status(400).json({ ok: false, error: "Use the Bible Study share flow to edit this response." });
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

router.delete("/:id/posts/:postId/replies/:replyId", requireAuth(), async (req, res) => {
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

    const all = await CommunityReply.find({ post: post._id }).select("_id parentReply createdAt studySubmission").lean();

    const byParent = new Map();
    for (const reply of all) {
      const parentKey = reply.parentReply ? String(reply.parentReply) : "root";
      if (!byParent.has(parentKey)) byParent.set(parentKey, []);
      byParent.get(parentKey).push(reply);
    }

    const toDelete = new Set();
    const stack = [String(replyId)];
    while (stack.length) {
      const currentId = stack.pop();
      if (toDelete.has(currentId)) continue;
      toDelete.add(currentId);
      const children = byParent.get(currentId) || [];
      for (const child of children) stack.push(String(child._id));
    }

    const deleteIds = [...toDelete];
    const deletedReplies = all.filter((reply) => deleteIds.includes(String(reply._id)));
    const deletedCount = deletedReplies.length;
    const deletedRootCount = deletedReplies.filter((reply) => !reply.parentReply).length;
    const studySubmissionIds = deletedReplies
      .map((reply) => (reply.studySubmission ? String(reply.studySubmission) : null))
      .filter(Boolean);

    await CommunityReply.deleteMany({ _id: { $in: deleteIds }, post: post._id });

    if (studySubmissionIds.length) {
      await BibleStudySubmission.deleteMany({ _id: { $in: studySubmissionIds } });
    }

    const remaining = await CommunityReply.find({ post: post._id }).sort({ createdAt: -1 }).limit(1).lean();
    const last = remaining[0] || null;

    post.replyCount = Math.max(0, (post.replyCount || 0) - deletedCount);
    post.lastReplyAt = last ? last.createdAt : null;
    await post.save();

    await bumpCommunityActivity(communityId);

    return res.json({ ok: true, deletedCount, deletedRootCount });
  } catch (err) {
    console.error("[delete reply error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

module.exports = router;
