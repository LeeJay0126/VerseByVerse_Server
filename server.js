const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const cors = require("cors");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");

const envFiles = [".env", ".env.local"];

for (const envFile of envFiles) {
  const envPath = path.join(__dirname, envFile);
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: envFile !== ".env" });
  }
}

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
const PRODUCTION_WEB_ORIGINS = [
  "https://versebyverse.website",
  "https://www.versebyverse.website",
];

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

const allowedOrigins = parseOriginList(
  CLIENT_ORIGIN,
  CLIENT_ORIGINS,
  ...(isProduction ? PRODUCTION_WEB_ORIGINS : [])
);

function getMongoUri() {
  const rawValue = String(MONGO_URI || "");
  const mongoUri = rawValue.trim();

  if (!mongoUri) {
    throw new Error(
      "MONGO_URI is not set. Expected a full MongoDB connection string starting with mongodb:// or mongodb+srv://"
    );
  }

  if (rawValue !== mongoUri) {
    throw new Error("MONGO_URI has leading or trailing whitespace. Remove any extra spaces or line breaks.");
  }

  if (!/^mongodb(\+srv)?:\/\//.test(mongoUri)) {
    throw new Error(
      "MONGO_URI must start with mongodb:// or mongodb+srv://. Check the value in your .env file."
    );
  }

  return mongoUri;
}

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

function isAllowedRequestOrigin(origin) {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) return true;
  if (allowedOrigins.includes(normalizedOrigin)) return true;
  return !isProduction && isLanOrigin(normalizedOrigin);
}

function getRequestOrigin(req) {
  const origin = req.get("origin");
  if (origin) return origin;

  const referer = req.get("referer");
  if (!referer) return "";

  try {
    const url = new URL(referer);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

console.log(">>> boot");
console.log("NODE_ENV =", NODE_ENV);
console.log("PORT =", PORT);
console.log("HOST =", HOST);
console.log("ALLOWED_ORIGINS =", allowedOrigins);
console.log("MONGO_URI present? ", !!MONGO_URI);

let mongoUri;
try {
  mongoUri = getMongoUri();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}

const app = express();

app.use((req, res, next) => {
  res.setHeader("X-SERVER-FINGERPRINT", "v1-notes-cors-debug");
  next();
});

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedRequestOrigin(origin)) {
      return callback(null, true);
    }

    const normalizedOrigin = normalizeOrigin(origin);
    return callback(new Error(`CORS blocked for origin: ${normalizedOrigin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use((req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();

  const requestOrigin = getRequestOrigin(req);
  if (requestOrigin && !isAllowedRequestOrigin(requestOrigin)) {
    return res.status(403).json({ ok: false, error: "Request origin not allowed" });
  }

  return next();
});

app.use((req, _res, next) => {
  if (req.method === "OPTIONS") {
    console.log("OPTIONS fell through:", req.originalUrl);
  }
  next();
});

app.use(morgan("dev"));
app.use(express.json());
app.use(cookieParser());

if (TRUST_PROXY) {
  const numericTrustProxy = Number(TRUST_PROXY);
  app.set("trust proxy", Number.isNaN(numericTrustProxy) ? TRUST_PROXY : numericTrustProxy);
} else {
  app.set("trust proxy", isProduction ? 1 : false);
}

app.use(
  session({
    name: "connect.sid",
    secret: SESSION_SECRET,
    resave: false,
    rolling: true,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: mongoUri,
      collectionName: "sessions",
      ttl: 60 * 60 * 2,
    }),
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : false,
      maxAge: 1000 * 60 * 60 * 2,
    },
  })
);

app.get("/health", (_req, res) => res.status(200).json({ ok: true, status: "up" }));

app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/api", passageRoutes);
app.use("/community", communityRoutes);
app.use("/community", communityPostRoutes);
app.use("/community", communityCommentRoutes);
app.use("/notifications", notificationRoutes);
app.use("/notes", notesRoutes);

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use((err, _req, res, _next) => {
  console.error("[unhandled error]", err);
  const message = isProduction ? "Internal server error" : err.message;
  res.status(500).json({ ok: false, error: message });
});

(async () => {
  try {
    console.log(">>> connecting to MongoDB...");
    mongoose.set("strictQuery", true);
    await mongoose.connect(mongoUri);
    console.log("MongoDB connected");

    app.listen(PORT, HOST, () => {
      console.log(`LISTENING: http://${HOST}:${PORT}`);
    });
  } catch (e) {
    console.error("ERROR: startup failed:", e?.message || e);
    if (e?.message?.includes("Invalid scheme")) {
      console.error("ERROR: MONGO_URI must use mongodb:// or mongodb+srv://");
    }
    if (e?.message?.includes("bad auth") || e?.message?.includes("Authentication failed")) {
      console.error("ERROR: Check the MongoDB username, password, and authSource in MONGO_URI");
    }
    process.exit(1);
  }
})();
