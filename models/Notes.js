const mongoose = require("mongoose");

const NoteSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    bibleId: { type: String, required: true, index: true },
    chapterId: { type: String, required: true, index: true },

    rangeStart: { type: Number, default: null },
    rangeEnd: { type: Number, default: null },

    title: { type: String, default: "" },
    text: { type: String, default: "" },
  },
  { timestamps: true }
);

NoteSchema.index({ user: 1, updatedAt: -1 });
NoteSchema.index({ user: 1, bibleId: 1, chapterId: 1, updatedAt: -1 });
NoteSchema.index({ user: 1, bibleId: 1, chapterId: 1, rangeStart: 1, rangeEnd: 1 });

module.exports = mongoose.model("Note", NoteSchema);
