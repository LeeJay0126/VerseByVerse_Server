
module.exports = function requireAuth(req, res, next) {
  if (req.method === "OPTIONS") return next();
  if (!req.session?.userId) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }
  next();
};
