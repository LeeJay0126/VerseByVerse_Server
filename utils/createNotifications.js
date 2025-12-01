const Notification = require("../models/Notifications");

async function createNotification({
  user,        
  type,
  message,
  community,
  actor,
  target,
}) {
  return Notification.create({
    user,
    type,
    message,
    community,
    actor,
    target,
  });
}

module.exports = createNotification;
