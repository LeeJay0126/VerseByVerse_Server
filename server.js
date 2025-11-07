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
// ---------- KOREAN / PASSAGE AGGREGATION ----------
// ---------- KOREAN / PASSAGE AGGREGATION ----------
// ---------- KOREAN / PASSAGE AGGREGATION ----------
app.get("/api/passage/:versionId/:chapterId", async (req, res) => {
  const { versionId, chapterId } = req.params;

  if (!versionId || !chapterId) {
    return res.status(400).json({ error: "Missing versionId or chapterId" });
  }

  try {
    // ---------- KOREAN (KOR via ibibles.net) ----------
    if (versionId === "kor") {
      const [bookCode, chapterStr] = chapterId.split(".");
      const chapterNumber = Number(chapterStr);

      if (!bookCode || !chapterNumber) {
        return res.status(400).json({ error: "Invalid KOR chapterId" });
      }

      // Ask ibibles for a wide range of verses in that chapter
      const upstreamUrl = `http://ibibles.net/quote.php?kor-${bookCode}/${chapterNumber}:1-200`;
      console.log("[KOR] Fetch:", upstreamUrl);

      const upstreamRes = await fetch(upstreamUrl);
      if (!upstreamRes.ok) {
        console.error("KOR upstream error", upstreamRes.status, upstreamUrl);
        return res
          .status(502)
          .json({ error: `KOR upstream ${upstreamRes.status}` });
      }

      const html = await upstreamRes.text();

      // 1) Strip HTML tags
      let plain = html.replace(/<[^>]*>/g, " ");

      // 2) Remove "Bible Quote"
      plain = plain.replace(/Bible\s*Quote:?/gi, " ");

      // 3) Normalize whitespace
      plain = plain.replace(/\s+/g, " ").trim();

      // 4) Drop leading book/chapter heading like "레위기 3장" / "레위기3장"
      // (Korean letters + anything up to "[number]장")
      plain = plain
        .replace(/^[\u3131-\uD79D\w\s"'「」()]+?\d+\s*장\s*/u, " ")
        .trim();

      // At this point we expect patterns like:
      //   3:1 ... 3:2 ... 3:3 ...
      // REGEX:
      //   (chapter):(verse) [text until next (chapter):(verse) or end]
      const verseRegex =
        /(\d+)\s*:\s*(\d+)\s*([^]*?)(?=(\d+)\s*:\s*(\d+)\s*|$)/g;

      const verses = [];
      let match;

      while ((match = verseRegex.exec(plain)) !== null) {
        const chap = parseInt(match[1], 10);
        const verseNum = parseInt(match[2], 10);
        let body = (match[3] || "").trim();

        if (isNaN(chap) || isNaN(verseNum)) continue;
        if (chap !== chapterNumber) continue; // ignore spillover from other chapters
        if (!body) continue;

        // final cleanup: collapse spaces, no "3:1" etc inside
        body = body.replace(/\s+/g, " ").trim();
        if (!body) continue;

        const id = `${bookCode}.${chapterNumber}.${verseNum}`;

        // avoid duplicates
        if (!verses.some((v) => v.id === id)) {
          verses.push({
            id,
            number: verseNum,
            text: body,
          });
        }
      }

      // Fallback: if parsing failed, return whole thing as v1
      if (verses.length === 0 && plain) {
        verses.push({
          id: `${bookCode}.${chapterNumber}.1`,
          number: 1,
          text: plain,
        });
      }

      const payload = {
        versionId,
        chapterId,
        bookId: bookCode,
        chapter: chapterNumber,
        verses,
      };

      return res.json(payload);
    }

    // ---------- OTHER VERSIONS ----------
    // (hook api.bible aggregation here later)
    return res.status(501).json({ error: "Not implemented for this versionId" });
  } catch (err) {
    console.error("Error fetching passage:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});


// ---------- START SERVER ----------

app.listen(PORT, () =>
  console.log(`Server running at http://localhost:${PORT}`)
);
