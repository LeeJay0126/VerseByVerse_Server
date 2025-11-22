const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  firstName: { type: String, trim: true },
  lastName:  { type: String, trim: true },
  email:     { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:  { type: String, required: true },
  role:      { type: String, default: "user" },
  provider:  { type: String, default: "local" },
  providerId:{ type: String }
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);
