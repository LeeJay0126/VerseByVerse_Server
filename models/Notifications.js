const mongoose = require("mongoose");

const TargetSchema = new mongoose.Schema(
  {
    kind: { type: String, default: null },
    id: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { _id: false }
);

const NotificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, required: true, index: true },
    message: { type: String, required: true },
    community: { type: mongoose.Schema.Types.ObjectId, ref: "Community", default: null, index: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    target: { type: TargetSchema, default: null },
    dedupeKey: { type: String, default: null, index: true },
    readAt: { type: Date, default: null, index: true },
    status: { type: String, default: null },
  },
  { timestamps: true }
);

NotificationSchema.index(
  { user: 1, type: 1, community: 1, dedupeKey: 1 },
  { unique: true, sparse: true }
);

module.exports = mongoose.model("Notification", NotificationSchema);