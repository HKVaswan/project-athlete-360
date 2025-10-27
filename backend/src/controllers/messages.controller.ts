import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";

// ───────────────────────────────
// 📨 Send a new message (admin, coach, or athlete)
export const sendMessage = async (req: Request, res: Response) => {
  try {
    const senderId = (req as any).userId;
    const { receiverId, title, content, attachments } = req.body;

    if (!receiverId || !title || !content) {
      return res
        .status(400)
        .json({ success: false, message: "receiverId, title, and content are required." });
    }

    const sender = await prisma.user.findUnique({ where: { id: senderId } });
    if (!sender)
      return res.status(404).json({ success: false, message: "Sender not found." });

    const receiver = await prisma.user.findUnique({ where: { id: receiverId } });
    if (!receiver)
      return res.status(404).json({ success: false, message: "Receiver not found." });

    const message = await prisma.message.create({
      data: {
        senderId,
        receiverId,
        title,
        content,
        attachments: attachments ? JSON.parse(JSON.stringify(attachments)) : null,
      },
    });

    res.status(201).json({
      success: true,
      message: "Message sent successfully.",
      data: message,
    });
  } catch (err) {
    logger.error("❌ sendMessage failed: " + err);
    res.status(500).json({ success: false, message: "Failed to send message." });
  }
};

// ───────────────────────────────
// 📬 Get received messages (inbox)
export const getInbox = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    const messages = await prisma.message.findMany({
      where: { receiverId: userId },
      orderBy: { createdAt: "desc" },
      include: {
        sender: { select: { id: true, username: true, role: true, name: true } },
      },
    });

    res.json({ success: true, data: messages });
  } catch (err) {
    logger.error("❌ getInbox failed: " + err);
    res.status(500).json({ success: false, message: "Failed to fetch inbox." });
  }
};

// ───────────────────────────────
// 📤 Get sent messages (outbox)
export const getSentMessages = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    const messages = await prisma.message.findMany({
      where: { senderId: userId },
      orderBy: { createdAt: "desc" },
      include: {
        receiver: { select: { id: true, username: true, role: true, name: true } },
      },
    });

    res.json({ success: true, data: messages });
  } catch (err) {
    logger.error("❌ getSentMessages failed: " + err);
    res.status(500).json({ success: false, message: "Failed to fetch sent messages." });
  }
};

// ───────────────────────────────
// 🔍 View single message (and mark as read)
export const getMessageById = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { id } = req.params;

    const message = await prisma.message.findUnique({
      where: { id },
      include: {
        sender: { select: { id: true, username: true, role: true, name: true } },
        receiver: { select: { id: true, username: true, role: true, name: true } },
      },
    });

    if (!message)
      return res.status(404).json({ success: false, message: "Message not found." });

    // Only sender or receiver can view
    if (message.senderId !== userId && message.receiverId !== userId) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized to view this message." });
    }

    // Mark as read if receiver views
    if (message.receiverId === userId && !message.read) {
      await prisma.message.update({
        where: { id },
        data: { read: true },
      });
    }

    res.json({ success: true, data: message });
  } catch (err) {
    logger.error("❌ getMessageById failed: " + err);
    res.status(500).json({ success: false, message: "Failed to fetch message details." });
  }
};

// ───────────────────────────────
// ✅ Mark a message as read manually
export const markMessageRead = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { id } = req.params;

    const message = await prisma.message.findUnique({ where: { id } });
    if (!message)
      return res.status(404).json({ success: false, message: "Message not found." });

    if (message.receiverId !== userId) {
      return res
        .status(403)
        .json({ success: false, message: "You can only mark your received messages." });
    }

    const updated = await prisma.message.update({
      where: { id },
      data: { read: true },
    });

    res.json({ success: true, message: "Message marked as read.", data: updated });
  } catch (err) {
    logger.error("❌ markMessageRead failed: " + err);
    res.status(500).json({ success: false, message: "Failed to mark message as read." });
  }
};

// ───────────────────────────────
// ❌ Delete a message (sender or receiver)
export const deleteMessage = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { id } = req.params;

    const message = await prisma.message.findUnique({ where: { id } });
    if (!message)
      return res.status(404).json({ success: false, message: "Message not found." });

    if (message.senderId !== userId && message.receiverId !== userId) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized to delete this message." });
    }

    await prisma.message.delete({ where: { id } });

    res.json({ success: true, message: "Message deleted successfully." });
  } catch (err) {
    logger.error("❌ deleteMessage failed: " + err);
    res.status(500).json({ success: false, message: "Failed to delete message." });
  }
};

// ───────────────────────────────
// 📢 Broadcast message to all athletes/coaches in institution (admin only)
export const broadcastMessage = async (req: Request, res: Response) => {
  try {
    const senderId = (req as any).userId;
    const { institutionId, targetRole, title, content } = req.body;

    if (!institutionId || !targetRole || !title || !content) {
      return res.status(400).json({
        success: false,
        message: "institutionId, targetRole, title, and content are required.",
      });
    }

    const recipients = await prisma.user.findMany({
      where: { role: targetRole, coachInstitutions: { some: { institutionId } } },
    });

    if (recipients.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "No users found for broadcast." });
    }

    const messages = await prisma.$transaction(
      recipients.map((user) =>
        prisma.message.create({
          data: {
            senderId,
            receiverId: user.id,
            title,
            content,
          },
        })
      )
    );

    res.json({
      success: true,
      message: `Broadcast sent to ${recipients.length} ${targetRole}(s).`,
      count: recipients.length,
      data: messages,
    });
  } catch (err) {
    logger.error("❌ broadcastMessage failed: " + err);
    res.status(500).json({ success: false, message: "Failed to broadcast message." });
  }
};