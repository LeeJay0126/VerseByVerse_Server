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
      enum: ["COMMUNITY_INVITE", "COMMUNITY_JOIN_REQUEST", "COMMUNITY_NEW_POST"],
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
      kind: { type: String },
      id: { type: mongoose.Schema.Types.ObjectId },
    },
    dedupeKey: {
      type: String,
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "declined"],
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

NotificationSchema.index({ user: 1, readAt: 1, createdAt: -1 });
NotificationSchema.index({ user: 1, dedupeKey: 1 }, { unique: true, sparse: true });
NotificationSchema.index({ "target.kind": 1, "target.id": 1 });

module.exports = mongoose.model("Notification", NotificationSchema);