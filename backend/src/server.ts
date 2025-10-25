// server.ts (temporary debug version)
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/auth";

dotenv.config();

const app = express();

// TEMP: allow all origins while debugging (remove after tests)
app.use(cors());
app.use(express.json());

// Request logger (very short preview of body) — helps confirm requests reach server
app.use((req, _res, next) => {
  const origin = (req.headers.origin as string) || "no-origin";
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

app.use("/api/auth", authRoutes);

// 404 fallback
app.use((_, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

const PORT = Number(process.env.PORT) || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT} (DEBUG CORS: open)`);
});
