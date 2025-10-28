/**
 * src/controllers/messages.controller.ts
 * ---------------------------------------------------------
 * Robust messaging system for athletes, coaches, and admins.
 * - Supports 1:1 messaging and institutional communication.
 * - Handles optional attachments (linked via uploads table or S3).
 * - Fully paginated and role-secure.
 * ---------------------------------------------------------
 */

import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";
import { Errors, sendErrorResponse } from "../utils/errors";
import { paginate } from "../utils/pagination";

/* ------------------------------------------------------------------
   💬 Send Message (athlete, coach, or admin)
-------------------------------------------------------------------*/
export const sendMessage = async (req: Request, res: Response) => {
  try {
    const sender = req.user;
    if (!sender) throw Errors.Auth("Authentication required to send messages.");

    const { recipientId, content, attachments } = req.body;

    if (!recipientId || !content)
      throw Errors.Validation("Recipient and message content are required.");

    // Ensure recipient exists
    const recipient = await prisma.user.findUnique({ where: { id: recipientId } });
    if (!recipient) throw Errors.NotFound("Recipient not found.");

    // Save message
    const message = await prisma.message.create({
      data: {
        senderId: sender.id,
        recipientId,
        content,
        attachments: attachments ?? [],
      },
      include: {
        sender: { select: { id: true, name: true, role: true } },
        recipient: { select: { id: true, name: true, role: true } },
      },
    });

    logger.info(`📩 Message sent from ${sender.id} to ${recipientId}`);
    res.status(201).json({ success: true, data: message });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   📥 Get Inbox (All Conversations for current user)
-------------------------------------------------------------------*/
export const getInbox = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) throw Errors.Auth();

    const { prismaArgs, meta } = await paginate(req.query, "offset", {
      includeTotal: true,
      countFn: (where) => prisma.message.count({ where }),
      where: { OR: [{ recipientId: user.id }, { senderId: user.id }] },
    });

    const messages = await prisma.message.findMany({
      ...prismaArgs,
      where: { OR: [{ recipientId: user.id }, { senderId: user.id }] },
      include: {
        sender: { select: { id: true, name: true, role: true } },
        recipient: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: messages, meta });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   🧵 Get Message Thread (Between two users)
-------------------------------------------------------------------*/
export const getThread = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) throw Errors.Auth();

    const { participantId } = req.params;
    if (!participantId) throw Errors.Validation("Participant ID required.");

    const { prismaArgs, meta } = await paginate(req.query, "offset", {
      includeTotal: true,
      countFn: (where) => prisma.message.count({ where }),
      where: {
        OR: [
          { senderId: user.id, recipientId: participantId },
          { senderId: participantId, recipientId: user.id },
        ],
      },
    });

    const messages = await prisma.message.findMany({
      ...prismaArgs,
      where: {
        OR: [
          { senderId: user.id, recipientId: participantId },
          { senderId: participantId, recipientId: user.id },
        ],
      },
      include: {
        sender: { select: { id: true, name: true, role: true } },
        recipient: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    res.json({ success: true, data: messages, meta });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   🗑️ Delete Message (only by sender or admin)
-------------------------------------------------------------------*/
export const deleteMessage = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    const { id } = req.params;

    const message = await prisma.message.findUnique({ where: { id } });
    if (!message) throw Errors.NotFound("Message not found.");

    if (message.senderId !== user?.id && user?.role !== "admin")
      throw Errors.Forbidden("You do not have permission to delete this message.");

    await prisma.message.delete({ where: { id } });

    res.json({ success: true, message: "Message deleted successfully." });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   📊 Admin — Get Institution Messages
-------------------------------------------------------------------*/
export const getInstitutionMessages = async (req: Request, res: Response) => {
  try {
    const admin = req.user;
    if (admin?.role !== "admin")
      throw Errors.Forbidden("Only institution admins can view institutional messages.");

    const institutionUsers = await prisma.user.findMany({
      where: { institutionId: admin.institutionId },
      select: { id: true },
    });

    const userIds = institutionUsers.map((u) => u.id);

    const { prismaArgs, meta } = await paginate(req.query, "offset", {
      includeTotal: true,
      countFn: (where) => prisma.message.count({ where }),
      where: {
        OR: [
          { senderId: { in: userIds } },
          { recipientId: { in: userIds } },
        ],
      },
    });

    const messages = await prisma.message.findMany({
      ...prismaArgs,
      where: {
        OR: [
          { senderId: { in: userIds } },
          { recipientId: { in: userIds } },
        ],
      },
      include: {
        sender: { select: { id: true, name: true, role: true } },
        recipient: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: messages, meta });
  } catch (err) {
    sendErrorResponse(res, err);
  }
};