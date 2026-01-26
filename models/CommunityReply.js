const mongoose = require("mongoose");

const CommunityReplySchema = new mongoose.Schema(
  {
    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CommunityPost",
      required: true,
    },
    parentReply: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CommunityReply",
      default: null,
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    body: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true }
);

CommunityReplySchema.index({ post: 1, parentReply: 1, createdAt: 1 });

module.exports = mongoose.model("CommunityReply", CommunityReplySchema);
