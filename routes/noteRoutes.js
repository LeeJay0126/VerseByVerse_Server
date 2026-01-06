const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const Note = require("../models/Notes");

const router = express.Router();

const toNullOrNumber = (v) => {
  if (v === undefined || v === null || v === "" || v === "null") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const safeStr = (v, max) => String(v ?? "").trim().slice(0, max);

const buildPreview = (text) =>
  safeStr(text, 50000).replace(/\s+/g, " ").trim().slice(0, 160);

/**
 * GET /notes/list?q=&bibleId=&bookId=&sort=updatedAt:desc&limit=&offset=
 */
router.get("/list", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;

    const {
      q = "",
      bibleId = "",
      bookId = "",
      sort = "updatedAt:desc",
      limit = "50",
      offset = "0",
    } = req.query;

    const [fieldRaw, dirRaw] = String(sort).split(":");
    const field = fieldRaw === "title" ? "title" : "updatedAt";
    const dir = dirRaw === "asc" ? 1 : -1;

    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const off = Math.max(parseInt(offset, 10) || 0, 0);

    const filter = { user: userId };

    if (bibleId) filter.bibleId = bibleId;

    if (bookId) {
      // chapterId format: "GEN.1" -> starts with "GEN."
      filter.chapterId = { $regex: `^${bookId}\\.` };
    }

    if (q) {
      const rx = new RegExp(
        String(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i"
      );
      filter.$or = [{ title: rx }, { text: rx }];
    }

    const total = await Note.countDocuments(filter);

    const notes = await Note.find(filter)
      .sort({ [field]: dir })
      .skip(off)
      .limit(lim)
      .select("bibleId chapterId rangeStart rangeEnd title text updatedAt createdAt")
      .lean();

    const shaped = notes.map((n) => ({
      ...n,
      preview: buildPreview(n.text),
    }));

    return res.json({ ok: true, notes: shaped, total });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Failed to list notes" });
  }
});

/**
 * GET /notes/exists?bibleId=&chapterId=
 * IMPORTANT: must be before "/:id"
 */
router.get("/exists", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { bibleId, chapterId } = req.query;

    if (!bibleId || !chapterId) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing bibleId or chapterId" });
    }

    const exists = await Note.exists({ user: userId, bibleId, chapterId });
    return res.json({ ok: true, hasAnyNote: !!exists });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Failed to check notes" });
  }
});

/**
 * GET /notes/:id
 */
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { id } = req.params;

    const note = await Note.findOne({ _id: id, user: userId }).lean();
    if (!note) return res.status(404).json({ ok: false, error: "Note not found" });

    return res.json({ ok: true, note });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Failed to fetch note" });
  }
});

/**
 * PUT /notes/:id (update by id)
 */
router.put("/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { id } = req.params;

    const title = safeStr(req.body?.title, 120);
    const text = safeStr(req.body?.text, 50000);

    const note = await Note.findOneAndUpdate(
      { _id: id, user: userId },
      { $set: { title, text } },
      { new: true }
    ).lean();

    if (!note) return res.status(404).json({ ok: false, error: "Note not found" });
    return res.json({ ok: true, note });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Failed to update note" });
  }
});

/**
 * DELETE /notes/:id
 */
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { id } = req.params;

    const out = await Note.deleteOne({ _id: id, user: userId });
    if (!out.deletedCount) return res.status(404).json({ ok: false, error: "Note not found" });

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Failed to delete note" });
  }
});

/**
 * GET /notes?bibleId=&chapterId=&rangeStart=&rangeEnd=
 * Returns the most recently updated note for that scope (if any).
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { bibleId, chapterId, rangeStart, rangeEnd } = req.query;

    if (!bibleId || !chapterId) {
      return res.status(400).json({ ok: false, error: "Missing bibleId or chapterId" });
    }

    const note = await Note.findOne({
      user: userId,
      bibleId,
      chapterId,
      rangeStart: toNullOrNumber(rangeStart),
      rangeEnd: toNullOrNumber(rangeEnd),
    })
      .sort({ updatedAt: -1 })
      .lean();

    return res.json({ ok: true, note: note || null });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Failed to fetch note" });
  }
});

/**
 * POST /notes (create new note, NEVER overwrite)
 */
router.post("/", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { bibleId, chapterId, rangeStart, rangeEnd, title = "", text = "" } = req.body || {};

    if (!bibleId || !chapterId) {
      return res.status(400).json({ ok: false, error: "Missing bibleId or chapterId" });
    }

    const cleanTitle = safeStr(title, 120);
    const cleanText = safeStr(text, 50000);

    const note = await Note.create({
      user: userId,
      bibleId,
      chapterId,
      rangeStart: toNullOrNumber(rangeStart),
      rangeEnd: toNullOrNumber(rangeEnd),
      title: cleanTitle,
      text: cleanText,
    });

    return res.status(201).json({ ok: true, note });
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({
        ok: false,
        error: "Duplicate note key (drop the unique index to allow multiple notes per chapter/range).",
      });
    }
    console.error(e);
    return res.status(500).json({ ok: false, error: "Failed to create note" });
  }
});

module.exports = router;
