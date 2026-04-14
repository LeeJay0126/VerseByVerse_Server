const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildVerifyUrl,
  buildResetUrl,
  buildVerifyEmail,
  buildResetEmail,
} = require("../utils/mailer");

test("buildVerifyUrl uses the canonical web verify-email route", () => {
  const originalAppUrl = process.env.APP_URL;
  process.env.APP_URL = "https://app.versebyverse.com";

  try {
    const verifyUrl = buildVerifyUrl({
      email: "user@example.com",
      token: "abc123",
    });

    assert.equal(
      verifyUrl,
      "https://app.versebyverse.com/verify-email?email=user%40example.com&token=abc123"
    );
  } finally {
    process.env.APP_URL = originalAppUrl;
  }
});

test("buildResetUrl uses the canonical web reset-password route", () => {
  const originalAppUrl = process.env.APP_URL;
  process.env.APP_URL = "https://app.versebyverse.com";

  try {
    const resetUrl = buildResetUrl({
      email: "user@example.com",
      token: "abc123",
    });

    assert.equal(
      resetUrl,
      "https://app.versebyverse.com/reset-password?email=user%40example.com&token=abc123"
    );
  } finally {
    process.env.APP_URL = originalAppUrl;
  }
});

test("auth email templates keep web links and clean text", () => {
  const verify = buildVerifyEmail({
    appName: "VerseByVerse",
    verifyUrl: "https://app.versebyverse.com/verify-email?email=user%40example.com&token=abc123",
  });
  const reset = buildResetEmail({
    appName: "VerseByVerse",
    resetUrl: "https://app.versebyverse.com/reset-password?email=user%40example.com&token=abc123",
  });

  assert.match(verify.text, /didn't create this account/i);
  assert.match(reset.text, /didn't request this/i);
  assert.equal(verify.text.includes("didn?™t"), false);
  assert.equal(reset.text.includes("didn?™t"), false);
  assert.match(verify.html, /verify-email/);
  assert.match(reset.html, /reset-password/);
});
