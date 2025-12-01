const mongoose = require("mongoose");

const NotificationSchema = new mongoose.Schema(
  {
    // who this notification is for
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // type of notification
    type: {
      type: String,
      enum: [
        "COMMUNITY_INVITE",        // you were invited
        "COMMUNITY_JOIN_REQUEST",  // someone requested to join your community
        // later: "COMMUNITY_ROLE_CHANGED", "THREAD_REPLY", etc.
      ],
      required: true,
    },

    // short display text: "{Username} has invited you to join {CommunityName}"
    message: {
      type: String,
      required: true,
    },

    // context so the frontend knows where to go on click
    community: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Community",
    },
    actor: {
      // who triggered this (inviter / requester)
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    // read/unread
    readAt: {
      type: Date,
      default: null,
      index: true,
    },

    // generic “target” for future (e.g., join request id)
    target: {
      // example: { kind: "JOIN_REQUEST", id: ObjectId("...") }
      kind: String,
      id: {
        type: mongoose.Schema.Types.ObjectId,
      },
    },
  },
  { timestamps: true }
);

// fast query: unread for a user, newest first
NotificationSchema.index({ user: 1, readAt: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", NotificationSchema);
