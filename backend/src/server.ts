import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/auth";
import athleteRoutes from "./routes/athletes";
import institutionRoutes from "./routes/institutions";
import competitionRoutes from "./routes/competitions";
import messageRoutes from "./routes/messages";
import resourceRoutes from "./routes/resources";
import prisma from "./prismaClient";

dotenv.config();

const app = express();

// ───────────────────────────────
// 🌐 Global Middleware
// ───────────────────────────────
app.use(cors());
app.use(express.json());

// Simple request logger
app.use((req, _res, next) => {
  const origin = req.headers.origin || "no-origin";
  const shortBody = (() => {
    try {
      const s = JSON.stringify(req.body || {});
      return s.length > 300 ? s.slice(0, 300) + "…" : s;
    } catch {
      return "{}";
    }
  })();
  console.log(
    `[REQ] ${new Date().toISOString()} ${req.method} ${req.path} from=${origin} body=${shortBody}`
  );
  next();
});

// ───────────────────────────────
// 🩺 Health Check
// ───────────────────────────────
app.get("/", async (_req, res) => {
  try {
    // Verify database connection
    await prisma.$queryRaw`SELECT 1`;
    res
      .status(200)
      .send("✅ Project Athlete 360 Backend is running & DB connected!");
  } catch {
    res.status(500).send("⚠️ Server running but database connection failed!");
  }
});

// ───────────────────────────────
// 🚏 API ROUTES
// ───────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/athletes", athleteRoutes);
app.use("/api/institutions", institutionRoutes);
app.use("/api/competitions", competitionRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/resources", resourceRoutes);

// ───────────────────────────────
// 404 Fallback
// ───────────────────────────────
app.use((_, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found. Please verify the API endpoint.",
  });
});

// ───────────────────────────────
// 🧠 Server Startup
// ───────────────────────────────
const PORT = Number(process.env.PORT) || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Project Athlete 360 Backend running on port ${PORT}`);
});

export default app;