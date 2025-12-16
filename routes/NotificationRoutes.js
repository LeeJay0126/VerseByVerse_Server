const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const Notification = require("../models/Notifications");
const Community = require("../models/Community");
const CommunityMembership = require("../models/CommunityMembership");
const createNotification = require("../utils/createNotifications");

const router = express.Router();

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

// POST /notifications/:id/read
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
      return res
        .status(404)
        .json({ ok: false, error: "Notification not found" });
    }

    return res.json({ ok: true, notification });
  } catch (err) {
    console.error("[notification read error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// POST /notifications/read-all
router.post("/read-all", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;

    const result = await Notification.updateMany(
      { user: userId, readAt: null },
      { $set: { readAt: new Date() } }
    );

    return res.json({ ok: true, modifiedCount: result.modifiedCount });
  } catch (err) {
    console.error("[notifications read-all error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// DELETE /notifications
router.delete("/", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;

    const result = await Notification.deleteMany({ user: userId });

    if (result.deletedCount === 0) {
      // nothing was deleted
      return res
        .status(400)
        .json({ ok: false, error: "No notification to delete" });
    }

    return res.json({
      ok: true,
      deletedCount: result.deletedCount,
    });
  } catch (err) {
    console.error("[notifications delete-all error]", err);
    return res
      .status(500)
      .json({ ok: false, error: "Internal server error" });
  }
});


/**
 * POST /notifications/:id/act
 * Body: { action: "accept" | "decline" }
 */
router.post("/:id/act", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { id } = req.params;
    const { action } = req.body;

    if (!["accept", "decline"].includes(action)) {
      return res.status(400).json({ ok: false, error: "Invalid action" });
    }

    const notification = await Notification.findOne({
      _id: id,
      user: userId,
    }).exec();

    if (!notification) {
      return res
        .status(404)
        .json({ ok: false, error: "Notification not found" });
    }

    if (notification.status && notification.status !== "pending") {
      return res
        .status(400)
        .json({ ok: false, error: "Notification already handled" });
    }

    const { type, community: communityId, actor: otherUserId } = notification;

    if (!communityId) {
      return res.status(400).json({
        ok: false,
        error: "Notification missing community context",
      });
    }

    const community = await Community.findById(communityId).exec();
    if (!community) {
      notification.status = "declined";
      notification.readAt = new Date();
      await notification.save();
      return res.status(404).json({
        ok: false,
        error: "Community no longer exists",
      });
    }

    async function ensureMembership(user, role = "Member") {
      let membership = await CommunityMembership.findOne({
        user,
        community: community._id,
      }).exec();

      if (!membership) {
        membership = await CommunityMembership.create({
          user,
          community: community._id,
          role,
        });

        community.membersCount = (community.membersCount || 0) + 1;
        await community.save();
      }

      return membership;
    }

    if (type === "COMMUNITY_JOIN_REQUEST") {
      // this notification goes TO owner (or leader)
      // notification.actor = requester
      if (!["accept", "decline"].includes(action)) {
        return res.status(400).json({ ok: false, error: "Invalid action" });
      }

      if (action === "accept") {
        if (!otherUserId) {
          return res
            .status(400)
            .json({ ok: false, error: "Missing requester information" });
        }

        await ensureMembership(otherUserId, "Member");

        // Optional: notify requester that they were accepted
        await createNotification({
          user: otherUserId,
          type: "COMMUNITY_INVITE", // or a new type like "COMMUNITY_JOIN_ACCEPTED"
          message: `Your request to join ${community.header} was accepted.`,
          community: community._id,
          actor: userId,
        });
      }

      // mark original notification as handled
      notification.status = action === "accept" ? "accepted" : "declined";
      notification.readAt = new Date();
      await notification.save();
    } else if (type === "COMMUNITY_INVITE") {
      if (action === "accept") {
        await ensureMembership(userId, "Member");
      }

      notification.status = action === "accept" ? "accepted" : "declined";
      notification.readAt = new Date();
      await notification.save();
    } else {
      return res.status(400).json({
        ok: false,
        error: "Action not supported for this notification type",
      });
    }

    return res.json({ ok: true, notification });
  } catch (err) {
    console.error("[notification act error]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// DELETE /notifications/:id  (delete one)
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { id } = req.params;

    console.log("🔥 DELETE route hit", id);

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ ok: false, error: "Invalid notification id" });
    }

    const deleted = await Notification.findOneAndDelete({
      _id: id,
      user: userId,
    }).lean();

    if (!deleted) {
      return res.status(404).json({ ok: false, error: "Notification not found" });
    }

    return res.json({ ok: true, deletedId: id });
  } catch (err) {
    console.error("[notification delete-one error]", err);
    return res.status(500).json({ ok: false, error: "Unable to delete notification" });
  }
});


module.exports = router;
