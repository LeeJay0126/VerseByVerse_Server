// models/CommunityPollVote.js
const mongoose = require("mongoose");

const CommunityPollVoteSchema = new mongoose.Schema(
  {
    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CommunityPost",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // index into poll.options array
    optionIndex: {
      type: Number,
      required: true,
    },
  },
  { timestamps: true }
);

// Prevent duplicate votes on the same option by the same user
CommunityPollVoteSchema.index({ post: 1, user: 1, optionIndex: 1 }, { unique: true });

module.exports = mongoose.model("CommunityPollVote", CommunityPollVoteSchema);
