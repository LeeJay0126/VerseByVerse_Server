const Notification = require("../models/Notifications");

module.exports = async function createNotification({
  user,
  type,
  message,
  community = null,
  actor = null,
  target = null,
  dedupeKey,
  status = null,
} = {}) {
  if (!user || !type || !message) {
    console.error("[createNotification invalid payload]", {
      user,
      type,
      message,
      community,
      actor,
      target,
      dedupeKey,
      status,
    });
    throw new Error("createNotification requires user, type, and message");
  }

  const actionable = type === "COMMUNITY_INVITE" || type === "COMMUNITY_JOIN_REQUEST";
  const nextStatus = status || (actionable ? "pending" : null);
  const normalizedDedupeKey =
    typeof dedupeKey === "string" && dedupeKey.trim() ? dedupeKey.trim() : undefined;

  const doc = {
    user,
    type,
    message,
    community,
    actor,
    target: target && target.kind ? target : null,
    readAt: null,
    status: nextStatus,
  };

  if (normalizedDedupeKey) {
    doc.dedupeKey = normalizedDedupeKey;

    return Notification.findOneAndUpdate(
      {
        user: doc.user,
        type: doc.type,
        community: doc.community,
        dedupeKey: doc.dedupeKey,
      },
      { $set: doc },
      { new: true, upsert: true }
    ).lean();
  }

  return Notification.create(doc);
};