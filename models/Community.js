const mongoose = require("mongoose");

const CommunitySchema = new mongoose.Schema(
  {
    header: { type: String, required: true },
    subheader: { type: String, required: true },
    content: { type: String, required: true },

    type: {
      type: String,
      enum: ["Bible Study", "Read Through", "Church Organization", "Prayer Group", "Other"],
      required: true,
    },

    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    membersCount: {
      type: Number,
      default: 1,
    },

    settings: {
      leadersCanManageMembers: { type: Boolean, default: false },
    },

    lastActivityAt: {
      type: Date,
      default: Date.now,
    },

    heroImageUrl: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Community", CommunitySchema);