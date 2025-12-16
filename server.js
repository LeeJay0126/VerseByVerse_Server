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

console.log(">>> boot");
console.log("NODE_ENV =", NODE_ENV);
console.log("PORT =", PORT);
console.log("CLIENT_ORIGIN =", CLIENT_ORIGIN);
console.log("MONGO_URI present? ", !!MONGO_URI);

if (!MONGO_URI) {
  console.error("❌ MONGO_URI is not set");
  process.exit(1);
}

const app = express();

app.use((req, res, next) => {
  res.setHeader("X-CORS-SERVER", "v1-delete-enabled");
  next();
});


/* ---------- middleware ---------- */
app.use(morgan("dev"));
app.use(express.json());
app.use(cookieParser());

const corsOptions = {
  origin: "http://localhost:3000",
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-Requested-With"],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));

// Explicit preflight for the routes
app.options("/notifications", cors(corsOptions));
app.options("/notifications/:id", cors(corsOptions));


app.set("trust proxy", 1);

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
      secure: NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 2,
    },
  })
);

/* ---------- routes ---------- */
app.get("/health", (_req, res) => res.json({ ok: true, status: "up" }));

app.use("/auth", userRoutes);
app.use("/api", passageRoutes);
app.use("/community", communityRoutes);
app.use("/notifications", notificationRoutes);

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

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

    app.listen(PORT, () => {
      console.log(`✅ LISTENING: http://localhost:${PORT}`);
    });
  } catch (e) {
    console.error("❌ startup failed:", e);
    process.exit(1);
  }
})();
