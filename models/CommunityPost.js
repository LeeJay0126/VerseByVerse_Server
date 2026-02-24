const mongoose = require("mongoose");

const PollOptionSchema = new mongoose.Schema(
  {
    text: { type: String, trim: true, required: true },
  },
  { _id: false }
);

const PollSchema = new mongoose.Schema(
  {
    options: { type: [PollOptionSchema], default: [] },
    allowMultiple: { type: Boolean, default: false },
    anonymous: { type: Boolean, default: true },
  },
  { _id: false }
);

const CommunityPostSchema = new mongoose.Schema(
  {
    community: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Community",
      required: true,
      index: true,
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    body: { type: String, default: "" },

    type: {
      type: String,
      enum: ["announcements", "bible_study", "questions", "poll"],
      default: "bible_study",
      index: true,
    },

    poll: { type: PollSchema, default: undefined },

    replyCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.CommunityPost || mongoose.model("CommunityPost", CommunityPostSchema);