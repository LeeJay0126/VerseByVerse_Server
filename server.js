require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const cors = require("cors");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");

const userRoutes = require("./routes/UserRoutes");
const passageRoutes = require("./routes/KorProxy");
const communityRoutes = require("./routes/communityRoutes");
const notificationRoutes = require("./routes/NotificationRoutes");

const {
  PORT = 4000,
  MONGO_URI,
  SESSION_SECRET = "dev",
  NODE_ENV = "development",
  CLIENT_ORIGIN = "http://localhost:3000",
} = process.env;

if (!MONGO_URI) {
  console.error("❌ MONGO_URI is not set. Check your .env");
  process.exit(1);
}

console.log(">>> VerseByVerse auth server starting...");
console.log("NODE_ENV =", NODE_ENV);
console.log("CLIENT_ORIGIN =", CLIENT_ORIGIN);

const app = express();

// --- MongoDB ---
mongoose.set("strictQuery", true);
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((e) => {
    console.error("❌ Mongo error:", e);
    process.exit(1);
  });

// --- Middleware ---
app.use(morgan("dev"));
app.use(express.json());
app.use(cookieParser());


const corsOptions = {
  origin: CLIENT_ORIGIN,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-Requested-With"],
};

app.use(cors(corsOptions)); // 

app.set("trust proxy", 1);


// --- Session ---
app.use(
  session({
    name: "connect.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: MONGO_URI,
      collectionName: "sessions",
      ttl: 60 * 60 * 2, // 2 hours
    }),
    cookie: {
      httpOnly: true,
      secure: NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 2, // 2 hours
    },
  })
);

// Uploads
const path = require("path");

// --- Routes ---
app.get("/health", (_req, res) => res.json({ ok: true }));

// all user/auth endpoints: /auth/signup, /auth/login, /auth/me, /auth/logout
// server.js
app.use("/auth", userRoutes);

// bible passage endpoints: /api/passage/:versionId/:chapterId
app.use("/api", passageRoutes);

// Community related Routes. 
app.use("/community", communityRoutes);

// Notification Routes
app.use("/notifications", notificationRoutes);

// --- Global error handler (optional) ---
app.use((err, req, res, next) => {
  console.error("[unhandled error]", err);
  res.status(500).json({ ok: false, error: err.message });
});

// Hero image uploads (Multer)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// --- Start server ---
app.listen(PORT, () => {
  console.log(`✅ Server listening on http://localhost:${PORT}`);
});
