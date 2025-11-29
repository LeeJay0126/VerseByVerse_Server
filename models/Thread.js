
const mongoose = require("mongoose");

const ThreadSchema = new mongoose.Schema(
  {
    community: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Community",
      required: true,
    },
    title: { type: String, required: true },

    type: {
      type: String,
      enum: ["regular", "bible_study", "poll", "announcement"],
      default: "regular",
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // optional: for bible_study / verse-based threads
    verseRef: {
      versionId: String,
      bookId: String,
      chapter: Number,
      verseStart: Number,
      verseEnd: Number,
    },

    // poll-specific fields
    pollOptions: [
      {
        id: String, // simple client-side id like "A", "B", ...
        label: String,
      },
    ],
    pollClosesAt: Date,

    // announcements: always pinned in UI (type === "announcement")
    pinned: {
      type: Boolean,
      default: false,
    },

    lastActivityAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Thread", ThreadSchema);
