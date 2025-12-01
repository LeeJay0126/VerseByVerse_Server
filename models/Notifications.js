const mongoose = require("mongoose");

const NotificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        "COMMUNITY_INVITE",        // you were invited
        "COMMUNITY_JOIN_REQUEST",  // someone requested to join your community
      ],
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    community: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Community",
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    readAt: {
      type: Date,
      default: null,
      index: true,
    },
    target: {
      kind: String,
      id: {
        type: mongoose.Schema.Types.ObjectId,
      },
    },
    
    status: {
      type: String,
      enum: ["pending", "accepted", "declined"],
      default: "pending",
      index: true,
    },
  },
  { timestamps: true }
);

NotificationSchema.index({ user: 1, readAt: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", NotificationSchema);
