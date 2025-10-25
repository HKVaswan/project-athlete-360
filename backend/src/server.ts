// src/server.ts
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/auth";
import athleteRoutes from "./routes/athletes"; // ✅ Add this import

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// Request logger (helps during testing)
app.use((req, _res, next) => {
  const origin = req.headers.origin || "no-origin";
  const previewBody = (() => {
    try {
      if (!req.body) return "{}";
      const s = JSON.stringify(req.body);
      return s.length > 300 ? s.slice(0, 300) + "…" : s;
    } catch {
      return "{}";
    }
  })();
  console.log(`[REQ] ${new Date().toISOString()} ${req.method} ${req.path} origin=${origin} body=${previewBody}`);
  next();
});

// Health check
app.get("/", (_, res) => {
  res.status(200).send("✅ Project Athlete 360 Backend is running!");
});

// ✅ Mount routes
app.use("/api/auth", authRoutes);
app.use("/api/athletes", athleteRoutes); // <-- THIS WAS MISSING

// 404 fallback
app.use((_, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

const PORT = Number(process.env.PORT) || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});