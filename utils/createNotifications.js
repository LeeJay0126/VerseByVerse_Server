const Notification = require("../models/Notifications");

module.exports = async function createNotification({
  user,
  type,
  message,
  community = null,
  actor = null,
  target = null,
  dedupeKey = null,
  status = null,
}) {
  const actionable = type === "COMMUNITY_INVITE" || type === "COMMUNITY_JOIN_REQUEST";
  const nextStatus = status || (actionable ? "pending" : null);

  const doc = {
    user,
    type,
    message,
    community,
    actor,
    target: target && target.kind ? target : null,
    dedupeKey: dedupeKey || null,
    readAt: null,
    status: nextStatus,
  };

  if (doc.dedupeKey) {
    const updated = await Notification.findOneAndUpdate(
      { user: doc.user, type: doc.type, community: doc.community, dedupeKey: doc.dedupeKey },
      { $set: doc },
      { new: true, upsert: true }
    ).lean();
    return updated;
  }

  const created = await Notification.create(doc);
  return created;
};