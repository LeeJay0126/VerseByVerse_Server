// routes/passageRoutes.js
const express = require("express");
const fetch = require("node-fetch");

const router = express.Router();

// GET /api/passage/:versionId/:chapterId
router.get("/passage/:versionId/:chapterId", async (req, res) => {
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

      // 4) Drop leading book/chapter heading like "레위기 3장"
      plain = plain
        .replace(/^[\u3131-\uD79D\w\s"'「」()]+?\d+\s*장\s*/u, " ")
        .trim();

      // Extract verses: 3:1 ... 3:2 ...
      const verseRegex =
        /(\d+)\s*:\s*(\d+)\s*([^]*?)(?=(\d+)\s*:\s*(\d+)\s*|$)/g;

      const verses = [];
      let match;

      while ((match = verseRegex.exec(plain)) !== null) {
        const chap = parseInt(match[1], 10);
        const verseNum = parseInt(match[2], 10);
        let body = (match[3] || "").trim();

        if (isNaN(chap) || isNaN(verseNum)) continue;
        if (chap !== chapterNumber) continue;
        if (!body) continue;

        body = body.replace(/\s+/g, " ").trim();
        if (!body) continue;

        const id = `${bookCode}.${chapterNumber}.${verseNum}`;

        if (!verses.some((v) => v.id === id)) {
          verses.push({
            id,
            number: verseNum,
            text: body,
          });
        }
      }

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

    // ---------- OTHER VERSIONS (future) ----------
    return res.status(501).json({ error: "Not implemented for this versionId" });
  } catch (err) {
    console.error("Error fetching passage:", err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
