import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/auth";

dotenv.config();

const app = express();

// ✅ Explicit CORS setup for Render frontend
app.use(cors({
  origin: [
    "https://project-athlete-360-fd.onrender.com", // your frontend
    "http://localhost:5173",                       // local dev
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));

app.use(express.json());

// Health check
app.get("/", (_, res) => {
  res.status(200).send("✅ Project Athlete 360 Backend is running!");
});

// API routes
app.use("/api/auth", authRoutes);

// 404 fallback
app.use((_, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// ✅ Use numeric PORT and 0.0.0.0 (important for Render)
const PORT = Number(process.env.PORT) || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running and listening on port ${PORT}`);
});
