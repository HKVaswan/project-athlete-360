// src/app.ts
import express, { Application, Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { config } from "./config";
import logger from "./logger";
import { requestLogger } from "./middleware/requestLogger.middleware";
import { errorHandler } from "./middleware/error.middleware";
import routes from "./routes";

const app: Application = express();

// ───────────────────────────────
// 🧱 Security Middleware
// ───────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: config.CLIENT_URLS, // array or string of allowed origins
    credentials: true,
  })
);
app.use(compression());
app.use(cookieParser());

// ───────────────────────────────
// ⚙️ Basic Middleware
// ───────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Logging: Morgan (HTTP logs) + custom logger (structured)
app.use(morgan("tiny", { stream: { write: (msg) => logger.info(msg.trim()) } }));
app.use(requestLogger);

// ───────────────────────────────
// 🚦 Rate Limiting
// ───────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // limit each IP to 300 requests per window
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", limiter);

// ───────────────────────────────
// ✅ Health Check
// ───────────────────────────────
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "Server is healthy 🚀",
    env: config.NODE_ENV,
  });
});

// ───────────────────────────────
// 🚏 API Routes
// ───────────────────────────────
app.use("/api", routes);

// ───────────────────────────────
// ❌ Global Error Handler
// ───────────────────────────────
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error(`[UNCAUGHT ERROR]: ${err.stack || err}`);
  errorHandler(err, req, res, next);
});

// ───────────────────────────────
// ⚙️ 404 Handler
// ───────────────────────────────
app.use("*", (req: Request, res: Response) => {
  res.status(404).json({ success: false, message: "Endpoint not found" });
});

export default app;
