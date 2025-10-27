// src/server.ts
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import prisma from "./prismaClient";

// ─────────────── ROUTES ───────────────
import authRoutes from "./routes/auth";
import athleteRoutes from "./routes/athletes";
import institutionRoutes from "./routes/institutions";
import competitionRoutes from "./routes/competitions";
import messageRoutes from "./routes/messages";
import resourceRoutes from "./routes/resources";
// (future additions)
// import sessionRoutes from "./routes/sessions";
// import invitationRoutes from "./routes/invitations";

dotenv.config();
const app = express();

// ───────────────────────────────
// 🧠 Validate Environment
// ───────────────────────────────
if (!process.env.DATABASE_URL) {
  console.warn("⚠️ DATABASE_URL missing in .env — Prisma may fail to connect.");
}
if (!process.env.JWT_SECRET) {
  console.warn("⚠️ JWT_SECRET missing in .env — authentication may be insecure.");
}

// ───────────────────────────────
// 🌐 Global Middleware
// ───────────────────────────────
app.use(cors({ origin: "*", methods: ["GET", "POST", "PUT", "DELETE"] }));
app.use(express.json());
app.use(helmet()); // adds security headers

// Optional — basic rate limiting (prevents abuse)
app.use(
  rateLimit({
    windowMs: 60 * 1000, // 1 minute
    limit: 120, // 120 requests/minute
    message: "Too many requests, please try again later.",
  })
);

// Request Logger (compact + safe)
app.use((req: Request, _res: Response, next: NextFunction) => {
  const origin = req.headers.origin || "no-origin";
  const safeBody =
    typeof req.body === "object" && Object.keys(req.body).length
      ? JSON.stringify(req.body).slice(0, 200)
      : "";
  console.log(
    `[REQ] ${new Date().toISOString()} ${req.method} ${req.path} origin=${origin} body=${safeBody}`
  );
  next();
});

// ───────────────────────────────
// 🩺 Health Check
// ───────────────────────────────
app.get("/", async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).send("✅ Project Athlete 360 Backend is running & DB connected!");
  } catch (error) {
    console.error("Database check failed:", error);
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

// Future (optional)
// app.use("/api/sessions", sessionRoutes);
// app.use("/api/invitations", invitationRoutes);

// ───────────────────────────────
// ❌ 404 Fallback
// ───────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: "Route not found. Please verify the API endpoint.",
  });
});

// ───────────────────────────────
// ⚠️ Global Error Handler
// ───────────────────────────────
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("❌ Global error:", err);
  res.status(500).json({ success: false, message: "Internal server error" });
});

// ───────────────────────────────
// 🧠 Server Startup + Graceful Shutdown
// ───────────────────────────────
const PORT = Number(process.env.PORT) || 10000;

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Project Athlete 360 Backend running on port ${PORT}`);
});

// Graceful shutdown for Prisma
process.on("SIGINT", async () => {
  console.log("🧹 Closing database connection...");
  await prisma.$disconnect();
  server.close(() => {
    console.log("👋 Server shut down gracefully.");
    process.exit(0);
  });
});

export default app;