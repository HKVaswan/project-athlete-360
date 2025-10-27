import express from "express";
import {
  sendMessage,
  getInbox,
  getOutbox,
  getMessageById,
  markMessageAsRead,
  deleteMessage,
} from "../controllers/messages.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = express.Router();

/**
 * ───────────────────────────────
 * 💬 Messaging System Routes
 * ───────────────────────────────
 */

// ✉️ Send a new message (Admin, Coach, or Athlete)
router.post("/", requireAuth, sendMessage);

// 📥 Get all received messages for logged-in user
router.get("/inbox", requireAuth, getInbox);

// 📤 Get all sent messages by logged-in user
router.get("/outbox", requireAuth, getOutbox);

// 🔍 Get a specific message by ID
router.get("/:id", requireAuth, getMessageById);

// ✅ Mark message as read
router.patch("/:id/read", requireAuth, markMessageAsRead);

// 🗑️ Delete a message (soft delete or hard delete)
router.delete("/:id", requireAuth, deleteMessage);

export default router;