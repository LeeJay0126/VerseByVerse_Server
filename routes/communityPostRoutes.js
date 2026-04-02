const express = require("express");
const mongoose = require("mongoose");
const Community = require("../models/Community");
const CommunityMembership = require("../models/CommunityMembership");
const CommunityPost = require("../models/CommunityPost");
const CommunityPollVote = require("../models/CommunityPollVote");
const CommunityReply = require("../models/CommunityReply");
const Notification = require("../models/Notifications");
const User = require("../models/User");
const requireAuth = require("../middleware/requireAuth");
const { sanitizePagination } = require("../utils/bibleStudySubmission");

const router = express.Router();

const MAX_ANNOUNCEMENTS_PER_COMMUNITY = 3;

const bumpCommunityActivity = async (communityId) => {
  if (!communityId) return;
  await Community.updateOne({ _id: communityId }, { $set: { lastActivityAt: new Date() } });
};

const canManagePost = async ({ communityId, userId, postAuthorId }) => {
  if (String(postAuthorId) === String(userId)) return true;

  const membership = await CommunityMembership.findOne({ community: communityId, user: userId })
    .select("role")
    .lean();

  return !!membership && (membership.role === "Owner" || membership.role === "Leader");
};

const normalizePostType = (raw) => {
  const s = String(raw || "").trim().toLowerCase();
  const compact = s.replace(/[\s-_]/g, "");

  if (compact === "questions" || compact === "question") return "questions";
  if (compact === "announcements" || compact === "announcement") return "announcements";
  if (compact === "poll" || compact === "polls") return "poll";
  if (compact === "biblestudy" || compact === "biblestudies") return "bible_study";

  return "bible_study";
};

const mapTypeToClass = (type) => {
  switch (type) {
    case "questions":
      return "questions";
    case "announcements":
      return "announcements";
    case "poll":
      return "poll";
    case "bible_study":
      return "bible_study";
    default:
      return "bible_study";
  }
};

const trimString = (value) => (typeof value === "string" ? value.trim() : "");

const truncate = (value, max = 140) => {
  const text = trimString(value);
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
};

const toSubtitle = (body) => truncate(body, 140);

const normalizePassage = (raw) => {
  const next = raw && typeof raw === "object" ? raw : {};

  const chapterNumber = Number(next.chapterNumber);
  const rangeStart = Number(next.rangeStart);
  const rangeEnd = Number(next.rangeEnd);

  return {
    versionId: trimString(next.versionId),
    versionLabel: trimString(next.versionLabel),
    bookId: trimString(next.bookId),
    bookName: trimString(next.bookName),
    chapterId: trimString(next.chapterId),
    chapterNumber: Number.isFinite(chapterNumber) ? chapterNumber : null,
    rangeStart: Number.isFinite(rangeStart) ? rangeStart : null,
    rangeEnd: Number.isFinite(rangeEnd) ? rangeEnd : null,
    referenceLabel: trimString(next.referenceLabel),
  };
};

const normalizePassageSnapshot = (raw) => {
  const verses = Array.isArray(raw?.verses) ? raw.verses : [];
  return {
    verses: verses
      .map((verse) => ({
        number: Number(verse?.number),
        text: trimString(verse?.text),
      }))
      .filter((verse) => Number.isFinite(verse.number) && verse.text),
  };
};

const normalizeStudyContent = (raw) => {
  const next = raw && typeof raw === "object" ? raw : {};
  return {
    leaderNotes: trimString(next.leaderNotes),
    reflection: trimString(next.reflection),
    questions: Array.isArray(next.questions)
      ? next.questions.map((item) => trimString(item)).filter(Boolean)
      : [],
  };
};

const hasBibleStudyBody = ({ body, studyContent }) => {
  return Boolean(
    trimString(body) ||
      trimString(studyContent?.leaderNotes) ||
      trimString(studyContent?.reflection)
  );
};

const getBibleStudySubtitle = (post) => {
  const referenceLabel = trimString(post?.passage?.referenceLabel);
  const preview =
    trimString(post?.body) ||
    trimString(post?.studyContent?.leaderNotes) ||
    trimString(post?.studyContent?.reflection);

  if (referenceLabel && preview) {
    return truncate(`${referenceLabel} — ${preview}`, 140);
  }

  if (referenceLabel) return truncate(referenceLabel, 140);
  if (preview) return truncate(preview, 140);
  return "";
};

const typeToCategory = (t) => {
  if (t === "questions") return "Questions";
  if (t === "announcements") return "Announcements";
  if (t === "poll") return "Poll";
  return "Bible Study";
};

const buildDisplayName = (u) => {
  if (!u) return "A member";
  const fullName = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return fullName || u.username || "A member";
};

const buildBucketKey = (communityId, postType) => {
  return `COMMUNITY_NEW_POST:${String(communityId)}:${String(postType)}`;
};

const shouldNotifyUserForType = (membership, postType) => {
  const prefs = membership?.notificationPrefs || null;
  if (!prefs) return true;
  if (!Object.prototype.hasOwnProperty.call(prefs, postType)) return true;
  return prefs[postType] !== false;
};

const getRecipientIdsForPostType = (memberships, normalizedType, authorId) => {
  const ids = [];
  for (const m of memberships || []) {
    const uid = m?.user;
    if (!uid) continue;
    if (String(uid) === String(authorId)) continue;
    if (!shouldNotifyUserForType(m, normalizedType)) continue;
    ids.push(String(uid));
  }
  return [...new Set(ids)];
};



router.get("/:id/posts", requireAuth(), async (req, res) => {
  try {
    const { id: communityId } = req.params;
    const { page, limit } = sanitizePagination({
      page: req.query.page,
      limit: req.query.limit,
      maxLimit: 30,
    });

    const community = await Community.findById(communityId).exec();
    if (!community) return res.status(404).json({ ok: false, error: "Community not found" });

    const posts = await CommunityPost.find({ community: communityId })
      .sort({ createdAt: -1 })
      .populate("author", "username firstName lastName")
      .exec();

    const mapped = posts
      .map((p) => {
        const fullName = p.author
          ? [p.author.firstName, p.author.lastName].filter(Boolean).join(" ")
          : null;

        const subtitle =
          p.type === "bible_study" ? getBibleStudySubtitle(p) : toSubtitle(p.body);

        return {
          id: p._id,
          title: p.title,
          subtitle,
          category: typeToCategory(p.type),
          categoryClass: mapTypeToClass(p.type),
          replyCount: p.replyCount || 0,
          activityText: p.updatedAt || p.createdAt,
          author: fullName || p.author?.username || "Unknown",
          authorId: p.author?._id ? String(p.author._id) : null,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          type: p.type,
        };
      })
      .sort((a, b) => {
        const aPinned = a.type === "announcements" ? 1 : 0;
        const bPinned = b.type === "announcements" ? 1 : 0;
        if (aPinned !== bPinned) return bPinned - aPinned;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });

    const totalCount = mapped.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * limit;
    const result = mapped.slice(start, start + limit);

    return res.json({
      ok: true,
      posts: result,
      page: safePage,
      limit,
      totalCount,
      totalPages,
    });
  } catch (err) {
    console.error("[get community posts error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.post("/:id/posts", requireAuth(), async (req, res) => {
  try {
    const { id: communityId } = req.params;
    const userId = req.session.userId;

    const rawTitle = req.body?.title;
    const rawType = req.body?.type ?? req.body?.typeValue;
    const rawBody = req.body?.body ?? req.body?.description ?? "";

    const title = typeof rawTitle === "string" ? rawTitle.trim() : "";
    const body = typeof rawBody === "string" ? rawBody : "";

    const normalizedType = normalizePostType(rawType);

    const community = await Community.findById(communityId).exec();
    if (!community) return res.status(404).json({ ok: false, error: "Community not found" });

    const membership = await CommunityMembership.findOne({ user: userId, community: communityId }).exec();
    if (!membership) {
      return res.status(403).json({ ok: false, error: "You must join this community before posting." });
    }

    if (normalizedType === "bible_study" && membership.role !== "Owner" && membership.role !== "Leader") {
      return res.status(403).json({
        ok: false,
        error: "Only community leaders or the owner can create Bible Study posts.",
      });
    }

    if (normalizedType === "announcements") {
      const existingAnnouncementCount = await CommunityPost.countDocuments({
        community: communityId,
        type: "announcements",
      });

      if (existingAnnouncementCount >= MAX_ANNOUNCEMENTS_PER_COMMUNITY) {
        return res.status(400).json({
          ok: false,
          error: `This community already has the maximum of ${MAX_ANNOUNCEMENTS_PER_COMMUNITY} announcements.`,
        });
      }
    }

    const pollConfig = req.body?.poll;
    const passage = normalizedType === "bible_study" ? normalizePassage(req.body?.passage) : undefined;
    const passageSnapshot =
      normalizedType === "bible_study" ? normalizePassageSnapshot(req.body?.passageSnapshot) : undefined;
    const studyContent =
      normalizedType === "bible_study" ? normalizeStudyContent(req.body?.studyContent) : undefined;

    if (!title) {
      return res.status(400).json({ ok: false, error: "Title is required." });
    }

    if (normalizedType === "poll") {
      const cleanedOptions = (pollConfig?.options || [])
        .map((text) => ({ text: String(text).trim() }))
        .filter((option) => option.text);

      if (cleanedOptions.length < 2) {
        return res.status(400).json({ ok: false, error: "Please provide at least two poll options." });
      }
    } else if (normalizedType === "bible_study") {
      if (!passage?.referenceLabel || !passageSnapshot?.verses?.length) {
        return res.status(400).json({ ok: false, error: "A Bible Study post requires a valid passage." });
      }

      if (!hasBibleStudyBody({ body, studyContent })) {
        return res.status(400).json({
          ok: false,
          error: "Add an opening note, leader notes, or reflection before publishing.",
        });
      }
    } else if (!body || !body.trim()) {
      return res.status(400).json({ ok: false, error: "Title and body are required." });
    }

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
      ...(normalizedType === "bible_study"
        ? {
            passage,
            passageSnapshot,
            studyContent,
          }
        : {}),
    });

    await bumpCommunityActivity(communityId);

    try {
      const [memberships, authorUser] = await Promise.all([
        CommunityMembership.find({ community: communityId }).select("user notificationPrefs").lean().exec(),
        User.findById(userId).select("username firstName lastName").lean().exec(),
      ]);

      const authorName = buildDisplayName(authorUser);
      const postTypeLabel = typeToCategory(normalizedType);
      const message = `${authorName} posted a new ${postTypeLabel} post in ${community.header}.`;

      const recipientIds = getRecipientIdsForPostType(memberships, normalizedType, userId);

      if (recipientIds.length) {
        const bucketKey = buildBucketKey(community._id, normalizedType);

        const ops = recipientIds.map((uid) => ({
          updateOne: {
            filter: {
              user: uid,
              type: "COMMUNITY_NEW_POST",
              community: community._id,
              dedupeKey: bucketKey,
            },
            update: {
              $set: {
                user: uid,
                type: "COMMUNITY_NEW_POST",
                message,
                community: community._id,
                actor: userId,
                target: { kind: "COMMUNITY_POST", id: post._id },
                dedupeKey: bucketKey,
                readAt: null,
                status: null,
              },
              $setOnInsert: { createdAt: new Date() },
            },
            upsert: true,
          },
        }));

        try {
          await Notification.bulkWrite(ops, { ordered: false });
        } catch (e) {
          if (e?.code !== 11000) throw e;
        }
      }
    } catch (notifyErr) {
      console.error("[create community post notification error]", notifyErr);
    }

    return res.status(201).json({ ok: true, postId: String(post._id) });
  } catch (err) {
    console.error("[create community post error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.get("/:id/posts/:postId", requireAuth(), async (req, res) => {
  try {
    const { id: communityId, postId } = req.params;
    const userId = req.session.userId;

    const community = await Community.findById(communityId).exec();
    if (!community) return res.status(404).json({ ok: false, error: "Community not found" });

    const post = await CommunityPost.findOne({ _id: postId, community: communityId })
      .populate("author", "username firstName lastName")
      .exec();

    if (!post) return res.status(404).json({ ok: false, error: "Post not found" });

    const fullName = post.author
      ? [post.author.firstName, post.author.lastName].filter(Boolean).join(" ")
      : null;

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
      myVotes = votes.filter((v) => String(v.user) === String(userId)).map((v) => v.optionIndex);
    }

    return res.json({
      ok: true,
      post: {
        id: post._id,
        title: post.title,
        body: post.body,
        type: post.type,
        replyCount: post.replyCount || 0,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
        author: fullName || post.author?.username || "Unknown",
        authorId: post.author?._id ? String(post.author._id) : null,
        poll,
        pollResults,
        myVotes,
        passage: post.passage || null,
        passageSnapshot: post.passageSnapshot || null,
        studyContent: post.studyContent || null,
      },
      community: {
        id: community._id,
        header: community.header,
        subheader: community.subheader,
        heroImageUrl: community.heroImageUrl || null,
      },
    });
  } catch (err) {
    console.error("[get community post detail error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.put("/:id/posts/:postId", requireAuth(), async (req, res) => {
  try {
    const { id: communityId, postId } = req.params;
    const userId = req.session.userId;

    if (!mongoose.isValidObjectId(communityId) || !mongoose.isValidObjectId(postId)) {
      return res.status(400).json({ ok: false, error: "Invalid id" });
    }

    const { title, body, description, type, typeValue, poll } = req.body || {};

    const post = await CommunityPost.findOne({ _id: postId, community: communityId }).exec();
    if (!post) return res.status(404).json({ ok: false, error: "Post not found" });

    const allowed = await canManagePost({ communityId, userId, postAuthorId: post.author });
    if (!allowed) {
      return res.status(403).json({ ok: false, error: "Only the author or community leaders can edit this post." });
    }

    const nextTitle = typeof title === "string" ? title.trim() : "";
    const nextBody = typeof body === "string" ? body : typeof description === "string" ? description : "";

    if (!nextTitle) return res.status(400).json({ ok: false, error: "Title is required." });

    const normalizedType = normalizePostType(type ?? typeValue ?? post.type);

    if (normalizedType === "announcements" && post.type !== "announcements") {
      const existingAnnouncementCount = await CommunityPost.countDocuments({
        community: communityId,
        type: "announcements",
        _id: { $ne: post._id },
      });

      if (existingAnnouncementCount >= MAX_ANNOUNCEMENTS_PER_COMMUNITY) {
        return res.status(400).json({
          ok: false,
          error: `This community already has the maximum of ${MAX_ANNOUNCEMENTS_PER_COMMUNITY} announcements.`,
        });
      }
    }

    post.title = nextTitle;
    post.type = normalizedType;

    if (normalizedType === "poll") {
      post.body = nextBody || "";
      if (poll && Array.isArray(poll.options)) {
        post.poll = {
          options: poll.options.map((o) => ({ text: String(o?.text ?? o).trim() })).filter((o) => o.text),
          allowMultiple: !!poll.allowMultiple,
          anonymous: poll.anonymous !== false,
        };
      }
      post.passage = undefined;
      post.passageSnapshot = undefined;
      post.studyContent = undefined;
    } else if (normalizedType === "bible_study") {
      if (!nextBody.trim() && !trimString(post?.studyContent?.leaderNotes) && !trimString(post?.studyContent?.reflection)) {
        return res.status(400).json({
          ok: false,
          error: "Bible Study posts require some written content.",
        });
      }

      post.body = nextBody;

      if (req.body?.passage) {
        const nextPassage = normalizePassage(req.body.passage);
        if (!nextPassage.referenceLabel) {
          return res.status(400).json({ ok: false, error: "A valid passage is required." });
        }
        post.passage = nextPassage;
      }

      if (req.body?.passageSnapshot) {
        const nextSnapshot = normalizePassageSnapshot(req.body.passageSnapshot);
        if (!nextSnapshot.verses.length) {
          return res.status(400).json({ ok: false, error: "A valid passage snapshot is required." });
        }
        post.passageSnapshot = nextSnapshot;
      }

      if (req.body?.studyContent) {
        post.studyContent = normalizeStudyContent(req.body.studyContent);
      }

      post.poll = undefined;
    } else {
      if (!nextBody || !nextBody.trim()) {
        return res.status(400).json({ ok: false, error: "Body is required." });
      }
      post.body = nextBody;
      post.poll = undefined;
      post.passage = undefined;
      post.passageSnapshot = undefined;
      post.studyContent = undefined;
    }

    await post.save();
    await bumpCommunityActivity(communityId);

    return res.json({
      ok: true,
      post: {
        id: post._id,
        title: post.title,
        body: post.body,
        type: post.type,
        updatedAt: post.updatedAt,
        passage: post.passage || null,
        passageSnapshot: post.passageSnapshot || null,
        studyContent: post.studyContent || null,
      },
    });
  } catch (err) {
    console.error("[edit community post error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.delete("/:id/posts/:postId", requireAuth(), async (req, res) => {
  try {
    const { id: communityId, postId } = req.params;
    const userId = req.session.userId;

    if (!mongoose.isValidObjectId(communityId) || !mongoose.isValidObjectId(postId)) {
      return res.status(400).json({ ok: false, error: "Invalid id" });
    }

    const post = await CommunityPost.findOne({ _id: postId, community: communityId }).exec();
    if (!post) return res.status(404).json({ ok: false, error: "Post not found" });

    const allowed = await canManagePost({ communityId, userId, postAuthorId: post.author });
    if (!allowed) {
      return res.status(403).json({ ok: false, error: "Only the author or community leaders can delete this post." });
    }

    await Promise.all([
      CommunityReply.deleteMany({ post: post._id }),
      CommunityPollVote.deleteMany({ post: post._id }),
      Notification.deleteMany({ "target.kind": "COMMUNITY_POST", "target.id": post._id }),
      CommunityPost.deleteOne({ _id: post._id }),
    ]);

    await bumpCommunityActivity(communityId);

    return res.json({ ok: true, deletedPostId: String(postId) });
  } catch (err) {
    console.error("[delete community post error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.post("/:id/posts/:postId/vote", requireAuth(), async (req, res) => {
  try {
    const { id: communityId, postId } = req.params;
    const userId = req.session.userId;
    const { optionIndex } = req.body;

    if (typeof optionIndex !== "number") {
      return res.status(400).json({ ok: false, error: "optionIndex is required." });
    }

    const community = await Community.findById(communityId).exec();
    if (!community) return res.status(404).json({ ok: false, error: "Community not found" });

    const post = await CommunityPost.findOne({ _id: postId, community: communityId }).exec();
    if (!post || post.type !== "poll" || !post.poll) {
      return res.status(400).json({ ok: false, error: "This post is not a poll." });
    }

    if (optionIndex < 0 || optionIndex >= post.poll.options.length) {
      return res.status(400).json({ ok: false, error: "Invalid poll option." });
    }

    const membership = await CommunityMembership.findOne({ user: userId, community: communityId }).exec();
    if (!membership) {
      return res.status(403).json({ ok: false, error: "You must join this community to participate in polls." });
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

module.exports = router;