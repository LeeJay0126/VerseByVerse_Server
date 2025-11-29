// models/CommunityMembership.js
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
    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// A user can only have one membership per community
CommunityMembershipSchema.index({ user: 1, community: 1 }, { unique: true });

module.exports = mongoose.model("CommunityMembership", CommunityMembershipSchema);
