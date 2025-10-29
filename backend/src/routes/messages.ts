/**
 * src/routes/messages.ts
 * ---------------------------------------------------------
 * Handles secure messaging routes between users (athletes, coaches, admins).
 * - Fully protected by JWT auth middleware
 * - Supports attachments via S3
 * - Ready for future websocket or notification integration
 */

import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/roles.middleware";
import * as messageController from "../controllers/messages.controller";
import { uploadMiddleware } from "../middleware/upload.middleware";
import rateLimit from "express-rate-limit";

const router = Router();

/**
 * ⏱️ Rate limit to prevent message spam
 * (Customize as needed — safe for global use)
 */
const messageLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // max 30 requests/minute per user
  message: "Too many messages sent. Please wait before sending again.",
});

// 🔐 Protect all routes
router.use(requireAuth);

/**
 * 📬 Get all message threads for the authenticated user
 * Supports query filters (role, unreadOnly, etc.)
 */
router.get("/threads", messageController.getMessageThreads);

/**
 * 📥 Get a single message thread by ID (with pagination for older messages)
 */
router.get("/threads/:threadId", messageController.getThreadById);

/**
 * 📨 Send a message within a thread (text or attachments)
 * Attachments handled by upload middleware (S3 or local fallback)
 */
router.post(
  "/threads/:threadId/send",
  messageLimiter,
  uploadMiddleware.single("attachment"),
  messageController.sendMessage
);

/**
 * 🧾 Create a new message thread
 * (Typically used when initiating first contact between users)
 */
router.post("/", messageLimiter, messageController.createThread);

/**
 * 🔕 Mark messages as read (helps in notification systems)
 */
router.post("/threads/:threadId/read", messageController.markAsRead);

/**
 * 🧹 Delete a thread (soft delete for both users)
 */
router.delete("/threads/:threadId", messageController.deleteThread);

/**
 * ⚙️ Optional admin route to monitor or moderate abusive messages
 * (Future-ready for moderation dashboards)
 */
router.get(
  "/admin/all",
  requireRole("admin"),
  messageController.getAllThreadsForAdmin
);

export default router;