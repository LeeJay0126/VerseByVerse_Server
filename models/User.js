const mongoose = require("mongoose");

const MAX_NAME_LEN = 20;
const MAX_USERNAME_LEN = 20;

const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      trim: true,
      maxlength: MAX_NAME_LEN,
    },
    lastName: {
      type: String,
      trim: true,
      maxlength: MAX_NAME_LEN,
    },

    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      minlength: 4,
      maxlength: MAX_USERNAME_LEN,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },

    password: { type: String, required: true },
    // Password reset
    passwordResetTokenHash: { type: String },
    passwordResetTokenExpiresAt: { type: Date },
    passwordResetLastSentAt: { type: Date },

    role: { type: String, default: "user" },
    provider: { type: String, default: "local" },
    providerId: { type: String },

    // Email verification
    emailVerified: { type: Boolean, default: false },
    emailVerifiedAt: { type: Date },

    emailVerifyTokenHash: { type: String },
    emailVerifyTokenExpiresAt: { type: Date },
    emailVerifyLastSentAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);