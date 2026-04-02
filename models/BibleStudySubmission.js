const mongoose = require("mongoose");

const BibleStudySubmissionSchema = new mongoose.Schema(
  {
    community: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Community",
      required: true,
      index: true,
    },
    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CommunityPost",
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    reflection: {
      type: String,
      trim: true,
      default: "",
    },
    answers: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true }
);

BibleStudySubmissionSchema.index({ post: 1, user: 1 }, { unique: true });

module.exports =
  mongoose.models.BibleStudySubmission ||
  mongoose.model("BibleStudySubmission", BibleStudySubmissionSchema);
