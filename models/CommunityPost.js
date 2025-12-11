
const mongoose = require("mongoose");

const PollOptionSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true },
    votes: { type: Number, default: 0 },
  },
  { _id: false }
);

const CommunityPostSchema = new mongoose.Schema(
  {
    community: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Community",
      required: true,
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
    },
    body: {
      type: String,
      required: true,
      trim: true,
    },

    // Tag / category for styling
    type: {
      type: String,
      enum: ["general", "questions", "announcements", "poll"], // 👈 added poll
      default: "general",
    },

    // Poll configuration (only used when type === "poll")
    poll: {
      options: [PollOptionSchema],
      allowMultiple: { type: Boolean, default: false },
      anonymous: { type: Boolean, default: true },
    },

    replyCount: {
      type: Number,
      default: 0,
    },
    lastReplyAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CommunityPost", CommunityPostSchema);
