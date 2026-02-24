const mongoose = require("mongoose");

const PollOptionSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true },
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

    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 140,
    },

    body: {
      type: String,
      trim: true,
      required: function () {
        return this.type !== "poll";
      },
      default: "",
    },

    type: {
      type: String,
      enum: ["questions", "announcements", "poll", "bible_study"],
      default: "bible_study",
      index: true,
    },

    poll: {
      options: {
        type: [PollOptionSchema],
        default: undefined,
        validate: {
          validator: function (opts) {
            return this.type !== "poll" || (Array.isArray(opts) && opts.length >= 2);
          },
          message: "Poll must have at least 2 options.",
        },
      },
      allowMultiple: { type: Boolean, default: false },
      anonymous: { type: Boolean, default: true },
    },

    replyCount: { type: Number, default: 0 },
    lastReplyAt: { type: Date },
  },
  { timestamps: true }
);

CommunityPostSchema.index({ community: 1, createdAt: -1 });

module.exports = mongoose.model("CommunityPost", CommunityPostSchema);