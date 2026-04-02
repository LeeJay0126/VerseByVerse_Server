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

const PassageSchema = new mongoose.Schema(
  {
    versionId: { type: String, trim: true, default: "" },
    versionLabel: { type: String, trim: true, default: "" },
    bookId: { type: String, trim: true, default: "" },
    bookName: { type: String, trim: true, default: "" },
    chapterId: { type: String, trim: true, default: "" },
    chapterNumber: { type: Number, default: null },
    rangeStart: { type: Number, default: null },
    rangeEnd: { type: Number, default: null },
    referenceLabel: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const PassageVerseSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true },
    text: { type: String, trim: true, required: true },
  },
  { _id: false }
);

const PassageSnapshotSchema = new mongoose.Schema(
  {
    verses: { type: [PassageVerseSchema], default: [] },
  },
  { _id: false }
);

const StudyContentSchema = new mongoose.Schema(
  {
    leaderNotes: { type: String, trim: true, default: "" },
    reflection: { type: String, trim: true, default: "" },
    questions: { type: [String], default: [] },
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

    passage: { type: PassageSchema, default: undefined },
    passageSnapshot: { type: PassageSnapshotSchema, default: undefined },
    studyContent: { type: StudyContentSchema, default: undefined },

    replyCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.CommunityPost || mongoose.model("CommunityPost", CommunityPostSchema);