const multer = require("multer");
const path = require("path");
const fs = require("fs");

const heroUploadDir = path.join(__dirname, "..", "uploads", "community-heroes");
if (!fs.existsSync(heroUploadDir)) fs.mkdirSync(heroUploadDir, { recursive: true });

const allowedImageExtensionsByMime = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, heroUploadDir),
  filename: (req, file, cb) => {
    const ext = allowedImageExtensionsByMime[file.mimetype];
    cb(null, `community-${req.params.id}-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!allowedImageExtensionsByMime[file.mimetype]) {
      return cb(new Error("Only JPG, PNG, or WEBP images are allowed"));
    }
    cb(null, true);
  },
});

module.exports = upload;
