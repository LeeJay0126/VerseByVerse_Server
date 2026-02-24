const mongoose = require("mongoose");

const CommunityMembershipSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    community: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Community",
      required: true,
    },
    role: {
      type: String,
      enum: ["Owner", "Leader", "Member"],
      default: "Member",
    },
    notificationPrefs: {
      announcements: { type: Boolean, default: true },
      bible_study: { type: Boolean, default: true },
      questions: { type: Boolean, default: true },
      poll: { type: Boolean, default: true },
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

CommunityMembershipSchema.index({ user: 1, community: 1 }, { unique: true });

module.exports = mongoose.model("CommunityMembership", CommunityMembershipSchema);