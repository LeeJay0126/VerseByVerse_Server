require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const cors = require("cors");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");

const {
  PORT = 4000,
  MONGO_URI,
  SESSION_SECRET = "dev",
  NODE_ENV = "development",
  CLIENT_ORIGIN = "http://localhost:3000",
} = process.env;

console.log(">>> VerseByVerse auth server starting...");
console.log("MONGO_URI =", MONGO_URI);

const app = express();

// MongoDB 연결
mongoose.set("strictQuery", true);
mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((e) => { console.error("❌ Mongo error:", e); process.exit(1); });


app.use(morgan("dev"));
app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.set("trust proxy", 1);

// Sesseion
app.use(session({
  name: "connect.sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: MONGO_URI,
    collectionName: "sessions",
    ttl: 60 * 60 * 2
  }),
  cookie: {
    httpOnly: true,
    secure: NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 2
  }
}));

// 라우트 등록
app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/auth", require("./auth"));

app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
