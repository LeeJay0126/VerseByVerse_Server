const User = require("../models/User");

module.exports = function requireAuth(options = {}) {
  const { requireVerified = true } = options;

  return async function (req, res, next) {
    try {
      if (req.method === "OPTIONS") return next();

      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "Not authenticated" });
      }

      if (!requireVerified) return next();

      const user = await User.findById(userId).select("_id emailVerified");
      if (!user) {
        return res.status(401).json({ ok: false, error: "Not authenticated" });
      }

      if (!user.emailVerified) {
        return res
          .status(403)
          .json({ ok: false, error: "Email not verified" });
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
};