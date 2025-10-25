import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/auth";

dotenv.config();

const app = express();

// ✅ Use FRONTEND_URL from environment or default to your Render frontend
const allowedOrigins = [
  process.env.FRONTEND_URL || "https://project-athlete-360-fd.onrender.com",
  "http://localhost:5173", // local development
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("CORS policy: This origin is not allowed"));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));

app.use(express.json());

// ✅ Health check route (Render uptime pings)
app.get("/", (_, res) => {
  res.status(200).send("✅ Project Athlete 360 Backend is running!");
});

// ✅ API routes
app.use("/api/auth", authRoutes);

// ✅ 404 fallback for invalid routes
app.use((_, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// ✅ Use numeric PORT and bind to 0.0.0.0 for Render
const PORT = Number(process.env.PORT) || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running and listening on port ${PORT}`);
  console.log(`✅ Allowed origins: ${allowedOrigins.join(", ")}`);
});
