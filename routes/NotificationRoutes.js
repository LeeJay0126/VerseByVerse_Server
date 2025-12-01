const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const Community = require("../models/Community");
const CommunityMembership = require("../models/CommunityMembership");
const User = require("../models/User");
const createNotification = require("../utils/createNotification");

const router = express.Router();

router.post("/:id/read", requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.session.userId;

        const notification = await Notification.findOneAndUpdate(
            { _id: id, user: userId },
            { $set: { readAt: new Date() } },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({ ok: false, error: "Notification not found" });
        }

        return res.json({ ok: true, notification });
    } catch (err) {
        console.error("[notification read error]", err);
        return res.status(500).json({ ok: false, error: "Internal server error" });
    }
});

// GET /notifications?unread=true
router.get("/", requireAuth, async (req, res) => {
    try {
        const { unread } = req.query;
        const filter = { user: req.session.userId };

        if (unread === "true") {
            filter.readAt = null;
        }

        const notifications = await Notification.find(filter)
            .sort({ createdAt: -1 })
            .limit(50)
            .lean()
            .exec();

        return res.json({ ok: true, notifications });
    } catch (err) {
        console.error("[notifications list error]", err);
        return res.status(500).json({ ok: false, error: "Internal server error" });
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

        // TODO: check inviter is owner/leader using CommunityMembership
        // const membership = await CommunityMembership.findOne({ user: inviterId, community: communityId });
        // if (!membership || !["Owner", "Leader"].includes(membership.role)) { ... }

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
            // later you can add target: { kind: "INVITE", id: inviteDoc._id }
        });

        return res.json({ ok: true });
    } catch (err) {
        console.error("[community invite error]", err);
        return res.status(500).json({ ok: false, error: "Internal server error" });
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

        const community = await Community.findById(communityId).populate("owner").exec();
        if (!community) {
            return res.status(404).json({ ok: false, error: "Community not found" });
        }

        // TODO: optionally prevent duplicate pending requests

        const requester = await User.findById(requesterId).select("firstName lastName").exec();
        const requesterName = requester
            ? `${requester.firstName} ${requester.lastName}`
            : "A user";

        const message = `${requesterName} has requested to join ${community.header}.`;

        // For now, notify only the owner. Later you can include leaders too.
        await createNotification({
            user: community.owner, // receiver (owner)
            type: "COMMUNITY_JOIN_REQUEST",
            message,
            community: community._id,
            actor: requesterId,
            // target: { kind: "JOIN_REQUEST", id: joinRequestDoc._id } // once you add a join-request model
        });

        return res.json({ ok: true });
    } catch (err) {
        console.error("[community join-request error]", err);
        return res.status(500).json({ ok: false, error: "Internal server error" });
    }
});


module.exports = router;
