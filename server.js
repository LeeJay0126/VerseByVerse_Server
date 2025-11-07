require("dotenv").config();
const express = require("express");
const session = require("express-session");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const fetch = require("node-fetch"); // ✅ NEW: for proxying KOR requests

const app = express();
const PORT = process.env.PORT || 4000;

// HARDCODED ACCOUNT FOR TESTING
const HARDCODED_USER = {
  email: "test@test.com",
  password: "1234",
  id: "user-001",
};

app.use(morgan("dev"));
app.use(express.json());
app.use(cookieParser());

// allow to take session cookie from frontend
app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);

// Session settings (to be changed to db)
app.use(
  session({
    secret: "dev-secret", // CHANGE WHEN PUBLISHING
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false, // false when local
      sameSite: "lax",
      maxAge: 1000 * 60 * 60, // 1 hour
    },
  })
);

// ---------- AUTH ROUTES (unchanged) ----------

// login
app.post("/auth/login", (req, res) => {
  const { email, password } = req.body;

  if (email === HARDCODED_USER.email && password === HARDCODED_USER.password) {
    req.session.userId = HARDCODED_USER.id;
    return res.json({
      ok: true,
      user: { id: HARDCODED_USER.id, email: HARDCODED_USER.email },
    });
  }
  return res.status(401).json({ ok: false, error: "Invalid credentials" });
});

// my info
app.get("/auth/me", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ ok: false, error: "Not logged in" });
  }
  return res.json({
    ok: true,
    user: { id: HARDCODED_USER.id, email: HARDCODED_USER.email },
  });
});

// logout
app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

// ---------- KOREAN BIBLE PROXY (NEW) ----------
// Frontend calls: GET /api/kor/:book/:chapter
// Example: /api/kor/ge/1 -> http://ibibles.net/quote.php?kor-ge/1
app.get("/api/kor/:book/:chapter", async (req, res) => {
  const { book, chapter } = req.params;

  if (!book || !chapter) {
    return res.status(400).send("Missing book or chapter");
  }

  // Request full chapter safely (1-9999 covers all possible verses)
  const upstreamUrl = `http://ibibles.net/quote.php?kor-${book}/${chapter}:1-9999`;

  try {
    const upstreamRes = await fetch(upstreamUrl);
    if (!upstreamRes.ok) {
      console.error("Upstream KOR error", upstreamRes.status, upstreamUrl);
      return res
        .status(upstreamRes.status)
        .send(`Upstream error ${upstreamRes.status}`);
    }

    const html = await upstreamRes.text();

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    console.error("Error fetching from ibibles:", err);
    res.status(500).send("Proxy error");
  }
});

// ---------- START SERVER ----------

app.listen(PORT, () =>
  console.log(`Server running at http://localhost:${PORT}`)
);
