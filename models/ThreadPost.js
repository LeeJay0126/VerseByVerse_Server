// models/ThreadPost.js
const mongoose = require("mongoose");

const ThreadPostSchema = new mongoose.Schema(
  {
    thread: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Thread",
      required: true,
    },
    community: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Community",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // For regular & bible_study: text content
    text: {
      type: String,
      default: "",
    },

    // For poll votes: which option was chosen
    pollOptionId: String,

    // For bible_study: optional verseRef override (like memo style)
    verseRef: {
      versionId: String,
      bookId: String,
      chapter: Number,
      verseStart: Number,
      verseEnd: Number,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ThreadPost", ThreadPostSchema);
