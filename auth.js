const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("./models/User");
const router = express.Router();

router.post("/signup", async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body || {};
    if (!firstName || !lastName) return res.status(400).json({ ok:false, error:"name required" });
    if (!email || !password)     return res.status(400).json({ ok:false, error:"email/password required" });

    console.log("[signup payload]", { firstName, lastName, email, password });

    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ ok:false, error:"Email already registered" });

    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ firstName, lastName, email, password: hash });

    req.session.userId = user._id.toString();
    return res.status(201).json({
      ok: true,
      user: { id: user._id, email: user.email, firstName: user.firstName, lastName: user.lastName }
    });
  } catch (e) {
    if (e?.code === 11000) return res.status(409).json({ ok:false, error:"Email already registered" });
    return res.status(500).json({ ok:false, error:e.message });
  }
});


router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ ok:false, error:"email/password required" });

  const user = await User.findOne({ email });
  if (!user) return res.status(401).json({ ok:false, error:"Invalid credentials" });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ ok:false, error:"Invalid credentials" });

  req.session.userId = user._id.toString();
  return res.json({ ok:true, user:{ id:user._id, email:user.email, firstName:user.firstName, lastName:user.lastName } });
});


router.get("/me", async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ ok:false, error:"Not authenticated" });
  const user = await User.findById(req.session.userId).select("_id email firstName lastName role createdAt");
  return res.json({ ok:true, user });
});


router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok:true });
  });
});

module.exports = router;
