// scripts/backfillUsernames.js
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User"); // adjust path if needed

const { MONGO_URI } = process.env;

if (!MONGO_URI) {
  console.error("MONGO_URI not set in .env");
  process.exit(1);
}

function makeBaseUsername(user) {
  // Priority: email local-part, then first+last, then random
  if (user.email) {
    const local = user.email.split("@")[0];
    if (local) return local.toLowerCase().replace(/[^a-z0-9._-]/gi, "");
  }

  if (user.firstName || user.lastName) {
    const base = `${user.firstName || ""}${user.lastName || ""}`;
    return base.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9._-]/gi, "");
  }

  return `user${user._id.toString().slice(-6).toLowerCase()}`;
}

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log("✅ Connected to MongoDB");

  const users = await User.find({ $or: [{ username: { $exists: false } }, { username: null }, { username: "" }] });

  console.log(`Found ${users.length} users without username`);

  for (const user of users) {
    let base = makeBaseUsername(user);
    if (!base) {
      base = `user${user._id.toString().slice(-6).toLowerCase()}`;
    }

    let candidate = base;
    let suffix = 1;

    // Ensure uniqueness
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // check if another user already has that username
      const existing = await User.findOne({
        _id: { $ne: user._id },
        username: candidate,
      });

      if (!existing) break; // it's free
      candidate = `${base}${suffix}`;
      suffix += 1;
    }

    user.username = candidate;
    await user.save();
    console.log(`Updated user ${user._id} -> username: ${candidate}`);
  }

  console.log("🎉 Backfill complete");
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill error:", err);
  process.exit(1);
});
