const mongoose = require("mongoose");

const CommunityJoinRequestSchema = new mongoose.Schema(
    {
        community: { type: mongoose.Schema.Types.ObjectId, ref: "Community", required: true, index: true },
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        status: { type: String, enum: ["pending", "accepted", "rejected"], default: "pending", index: true },
        handledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        handledAt: { type: Date, default: null },
    },
    { timestamps: true }
);

CommunityJoinRequestSchema.index({ community: 1, user: 1 }, { unique: true });

module.exports =
    mongoose.models.CommunityJoinRequest ||
    mongoose.model("CommunityJoinRequest", CommunityJoinRequestSchema);