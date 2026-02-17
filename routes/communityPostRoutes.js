const express = require("express");
const mongoose = require("mongoose");
const Community = require("../models/Community");
const CommunityMembership = require("../models/CommunityMembership");
const CommunityPost = require("../models/CommunityPost");
const CommunityPollVote = require("../models/CommunityPollVote");
const CommunityReply = require("../models/CommunityReply");
const Notification = require("../models/Notifications");
const requireAuth = require("../middleware/requireAuth");
const createNotification = require("../utils/createNotifications");

const router = express.Router();

const MAX_ANNOUNCEMENTS_PER_COMMUNITY = 3;

const bumpCommunityActivity = async (communityId) => {
    if (!communityId) return;
    await Community.updateOne({ _id: communityId }, { $set: { lastActivityAt: new Date() } });
};

const canManagePost = async ({ communityId, userId, postAuthorId }) => {
    if (String(postAuthorId) === String(userId)) return true;

    const membership = await CommunityMembership.findOne({
        community: communityId,
        user: userId,
    })
        .select("role")
        .lean();

    return !!membership && (membership.role === "Owner" || membership.role === "Leader");
};


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

const typeToCategory = (t) => {
    if (t === "questions") return "Questions";
    if (t === "announcements") return "Announcements";
    if (t === "poll") return "Poll";
    return "General";
};

router.get("/:id/posts", requireAuth, async (req, res) => {
    try {
        const { id: communityId } = req.params;

        const community = await Community.findById(communityId).exec();
        if (!community) return res.status(404).json({ ok: false, error: "Community not found" });

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
        if (!community) return res.status(404).json({ ok: false, error: "Community not found" });

        const membership = await CommunityMembership.findOne({ user: userId, community: communityId }).exec();
        if (!membership) {
            return res.status(403).json({ ok: false, error: "You must join this community before posting." });
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
            category: typeToCategory(normalizedType),
            categoryClass: mapTypeToClass(normalizedType),
            replyCount: 0,
            activityText: post.createdAt,
            createdAt: post.createdAt,
            updatedAt: post.updatedAt,
            type: normalizedType,
        };

        try {
            const memberships = await CommunityMembership.find({ community: communityId })
                .populate("user", "firstName lastName")
                .exec();

            const authorMembership = memberships.find((m) => String(m.user?._id) === String(userId));
            const authorName = authorMembership?.user
                ? [authorMembership.user.firstName, authorMembership.user.lastName].filter(Boolean).join(" ")
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

router.get("/:id/posts/:postId", requireAuth, async (req, res) => {
    try {
        const { id: communityId, postId } = req.params;
        const userId = req.session.userId;

        const community = await Community.findById(communityId).exec();
        if (!community) return res.status(404).json({ ok: false, error: "Community not found" });

        const post = await CommunityPost.findOne({ _id: postId, community: communityId })
            .populate("author", "username firstName lastName")
            .exec();

        if (!post) return res.status(404).json({ ok: false, error: "Post not found" });

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

router.put("/:id/posts/:postId", requireAuth, async (req, res) => {
    try {
        const { id: communityId, postId } = req.params;
        const userId = req.session.userId;

        if (!mongoose.isValidObjectId(communityId) || !mongoose.isValidObjectId(postId)) {
            return res.status(400).json({ ok: false, error: "Invalid id" });
        }

        const { title, body, type, poll } = req.body || {};

        const post = await CommunityPost.findOne({ _id: postId, community: communityId }).exec();
        if (!post) return res.status(404).json({ ok: false, error: "Post not found" });

        const allowed = await canManagePost({
            communityId,
            userId,
            postAuthorId: post.author,
        });

        if (!allowed) {
            return res.status(403).json({ ok: false, error: "Only the author or community leaders can edit this post." });
        }

        const nextTitle = typeof title === "string" ? title.trim() : "";
        const nextBody = typeof body === "string" ? body : "";

        if (!nextTitle) {
            return res.status(400).json({ ok: false, error: "Title is required." });
        }

        // Keep your existing type normalization logic
        const normalizedType = ["general", "questions", "announcements", "poll"].includes(String(type || "").toLowerCase())
            ? String(type).toLowerCase()
            : post.type || "general";

        // If switching TO announcements, enforce the cap (exclude this post from the count)
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

        // Body rules: polls may allow empty body
        if (normalizedType !== "poll") {
            if (!nextBody || !nextBody.trim()) {
                return res.status(400).json({ ok: false, error: "Body is required." });
            }
            post.body = nextBody;
            post.poll = undefined;
        } else {
            post.body = nextBody || "";

            // Optional: allow editing poll config if provided
            if (poll && Array.isArray(poll.options)) {
                post.poll = {
                    options: poll.options
                        .map((o) => ({ text: String(o?.text ?? o).trim() }))
                        .filter((o) => o.text),
                    allowMultiple: !!poll.allowMultiple,
                    anonymous: poll.anonymous !== false,
                };
            }
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
            },
        });
    } catch (err) {
        console.error("[edit community post error]", err);
        return res.status(500).json({ ok: false, error: "Internal server error" });
    }
});

router.delete("/:id/posts/:postId", requireAuth, async (req, res) => {
    try {
        const { id: communityId, postId } = req.params;
        const userId = req.session.userId;

        if (!mongoose.isValidObjectId(communityId) || !mongoose.isValidObjectId(postId)) {
            return res.status(400).json({ ok: false, error: "Invalid id" });
        }

        const post = await CommunityPost.findOne({ _id: postId, community: communityId }).exec();
        if (!post) return res.status(404).json({ ok: false, error: "Post not found" });

        const allowed = await canManagePost({
            communityId,
            userId,
            postAuthorId: post.author,
        });

        if (!allowed) {
            return res.status(403).json({ ok: false, error: "Only the author or community leaders can delete this post." });
        }

        await Promise.all([
            CommunityReply.deleteMany({ post: post._id }),
            CommunityPollVote.deleteMany({ post: post._id }),
            Notification.deleteMany({ post: post._id }),
            CommunityPost.deleteOne({ _id: post._id }),
        ]);

        await bumpCommunityActivity(communityId);

        return res.json({ ok: true, deletedPostId: String(postId) });
    } catch (err) {
        console.error("[delete community post error]", err);
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
