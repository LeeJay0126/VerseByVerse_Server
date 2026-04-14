require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const cors = require("cors");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const path = require("path");

const userRoutes = require("./routes/UserRoutes");
const authRoutes = require("./routes/auth");
const passageRoutes = require("./routes/KorProxy");
const communityRoutes = require("./routes/communityRoutes");
const communityPostRoutes = require("./routes/communityPostRoutes");
const communityCommentRoutes = require("./routes/communityCommentRoutes");
const notificationRoutes = require("./routes/NotificationRoutes");
const notesRoutes = require("./routes/noteRoutes");

const {
  PORT = 4000,
  HOST = "0.0.0.0",
  MONGO_URI,
  SESSION_SECRET = "dev",
  NODE_ENV = "development",
  CLIENT_ORIGIN = "http://localhost:3000",
  CLIENT_ORIGINS = "",
  TRUST_PROXY = "",
} = process.env;

const isProduction = NODE_ENV === "production";

function normalizeOrigin(value) {
  return String(value || "").trim().replace(/\/$/, "");
}

function parseOriginList(...values) {
  return Array.from(
    new Set(
      values
        .flatMap((value) => String(value || "").split(","))
        .map((value) => normalizeOrigin(value))
        .filter(Boolean)
    )
  );
}

const allowedOrigins = parseOriginList(CLIENT_ORIGIN, CLIENT_ORIGINS);

function isLanOrigin(origin) {
  try {
    const url = new URL(origin);
    const hostname = url.hostname || "";
    return (
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      hostname === "localhost" ||
      hostname === "127.0.0.1"
    );
  } catch {
    return false;
  }
}

console.log(">>> boot");
console.log("NODE_ENV =", NODE_ENV);
console.log("PORT =", PORT);
console.log("HOST =", HOST);
console.log("ALLOWED_ORIGINS =", allowedOrigins);
console.log("MONGO_URI present? ", !!MONGO_URI);

if (!MONGO_URI) {
  console.error("❌ MONGO_URI is not set");
  process.exit(1);
}

const app = express();

app.use((req, res, next) => {
  res.setHeader("X-SERVER-FINGERPRINT", "v1-notes-cors-debug");
  next();
});

const corsOptions = {
  origin(origin, callback) {
    const normalizedOrigin = normalizeOrigin(origin);

    if (!normalizedOrigin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(normalizedOrigin)) {
      return callback(null, true);
    }

    if (!isProduction && isLanOrigin(normalizedOrigin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked for origin: ${normalizedOrigin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use((req, _res, next) => {
  if (req.method === "OPTIONS") {
    console.log("❌ OPTIONS fell through:", req.originalUrl);
  }
  next();
});

/* ---------- middleware ---------- */
app.use(morgan("dev"));
app.use(express.json());
app.use(cookieParser());

if (TRUST_PROXY) {
  const numericTrustProxy = Number(TRUST_PROXY);
  app.set("trust proxy", Number.isNaN(numericTrustProxy) ? TRUST_PROXY : numericTrustProxy);
} else {
  app.set("trust proxy", isProduction ? 1 : false);
}

/* ---------- session ---------- */
app.use(
  session({
    name: "connect.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: MONGO_URI,
      collectionName: "sessions",
      ttl: 60 * 60 * 2,
    }),
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "lax" : false,
      maxAge: 1000 * 60 * 60 * 2,
    },
  })
);

/* ---------- routes ---------- */
app.get("/health", (_req, res) => res.json({ ok: true, status: "up" }));

app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/api", passageRoutes);
app.use("/community", communityRoutes);
app.use("/community", communityPostRoutes);
app.use("/community", communityCommentRoutes);
app.use("/notifications", notificationRoutes);
app.use("/notes", notesRoutes);

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/* ---------- error handler ---------- */
app.use((err, _req, res, _next) => {
  console.error("[unhandled error]", err);
  res.status(500).json({ ok: false, error: err.message });
});

/* ---------- connect + listen ---------- */
(async () => {
  try {
    console.log(">>> connecting to MongoDB...");
    mongoose.set("strictQuery", true);
    await mongoose.connect(MONGO_URI);
    console.log("✅ MongoDB connected");

    app.listen(PORT, HOST, () => {
      console.log(`✅ LISTENING: http://${HOST}:${PORT}`);
    });
  } catch (e) {
    console.error("❌ startup failed:", e);
    process.exit(1);
  }
})();
