const mongoose = require("mongoose");

const CommunitySchema = new mongoose.Schema(
  {
    header: { type: String, required: true },
    subheader: { type: String, required: true },
    content: { type: String, required: true },

    type: {
      type: String,
      enum: [
        "Bible Study",
        "Read Through",
        "Church Organization",
        "Prayer Group",
        "Other",
      ],
      required: true,
    },

    // Who created this community
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Denormalized member count for quick display
    membersCount: {
      type: Number,
      default: 1, // start with owner
    },

    lastActivityAt: {
      type: Date,
      default: Date.now,
    },
    heroImageUrl: { type: String }, // URL to the uploaded hero image
  },
  { timestamps: true }
);

module.exports = mongoose.model("Community", CommunitySchema);
