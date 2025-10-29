// src/services/message.service.ts
/**
 * Message Service (Enterprise-grade)
 * ----------------------------------
 * Handles all message and conversation logic across the system.
 * Supports:
 *  - Direct messages between users (athletes, coaches, admins)
 *  - Group/institution messages (if applicable)
 *  - Attachments (stored via S3 or external storage)
 *  - Read receipts
 *  - Pagination and soft deletion
 *  - Ready for WebSocket / real-time sync
 */

import prisma from "../prismaClient";
import logger from "../logger";
import { Errors } from "../utils/errors";
import { paginate, computeNextCursor } from "../utils/pagination";

type CreateMessagePayload = {
  senderId: string;
  recipientId?: string; // for direct message
  institutionId?: string; // for group message (optional)
  content?: string;
  attachments?: { url: string; type: string; name?: string }[];
  replyToId?: string | null; // for threaded replies
};

type GetMessagesQuery = {
  conversationId?: string;
  limit?: string | number;
  page?: string | number;
  cursor?: string;
};

type MarkReadPayload = {
  messageIds: string[];
  userId: string;
};

// ─────────────────────────────────────────────────────────────
// 📨 Create a new message
// ─────────────────────────────────────────────────────────────
export const createMessage = async (payload: CreateMessagePayload) => {
  const { senderId, recipientId, institutionId, content, attachments, replyToId } = payload;

  if (!senderId) throw Errors.Validation("Sender ID required");
  if (!recipientId && !institutionId)
    throw Errors.Validation("Recipient or Institution ID required");
  if (!content && (!attachments || attachments.length === 0))
    throw Errors.Validation("Message content or attachment required");

  // Verify sender exists
  const sender = await prisma.user.findUnique({ where: { id: senderId } });
  if (!sender) throw Errors.NotFound("Sender not found");

  // Verify recipient if applicable
  if (recipientId) {
    const recipient = await prisma.user.findUnique({ where: { id: recipientId } });
    if (!recipient) throw Errors.NotFound("Recipient not found");
  }

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        senderId,
        recipientId: recipientId ?? null,
        institutionId: institutionId ?? null,
        content: content ?? null,
        replyToId: replyToId ?? null,
        attachments:
          attachments && attachments.length > 0
            ? {
                createMany: {
                  data: attachments.map((a) => ({
                    url: a.url,
                    type: a.type,
                    name: a.name ?? null,
                  })),
                },
              }
            : undefined,
      },
      include: {
        sender: { select: { id: true, username: true, role: true } },
        recipient: { select: { id: true, username: true, role: true } },
        attachments: true,
      },
    });

    // Optional: enqueue push notification job
    // notificationService.enqueueNewMessage(created);

    return created;
  });

  logger.info(`📨 Message created from ${senderId} → ${recipientId || "institution"}`);
  return message;
};

// ─────────────────────────────────────────────────────────────
// 📋 Get conversation between two users
// ─────────────────────────────────────────────────────────────
export const getConversation = async (userAId: string, userBId: string, query: GetMessagesQuery) => {
  if (!userAId || !userBId) throw Errors.Validation("Both participant IDs required");

  const where = {
    OR: [
      { senderId: userAId, recipientId: userBId },
      { senderId: userBId, recipientId: userAId },
    ],
  };

  const { prismaArgs, meta } = await paginate(query, "offset", {
    where,
    countFn: (w) => prisma.message.count({ where: w }),
    includeTotal: true,
  });

  const messages = await prisma.message.findMany({
    ...prismaArgs,
    where,
    include: {
      sender: { select: { id: true, username: true, role: true } },
      recipient: { select: { id: true, username: true, role: true } },
      attachments: true,
      replyTo: { select: { id: true, content: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (query.cursor) meta.nextCursor = computeNextCursor(messages as any);
  return { data: messages, meta };
};

// ─────────────────────────────────────────────────────────────
// 🏫 Get all messages in an institution (group mode)
// ─────────────────────────────────────────────────────────────
export const getInstitutionMessages = async (institutionId: string, query: GetMessagesQuery) => {
  if (!institutionId) throw Errors.Validation("Institution ID required");

  const { prismaArgs, meta } = await paginate(query, "offset", {
    where: { institutionId },
    countFn: (w) => prisma.message.count({ where: w }),
    includeTotal: true,
  });

  const messages = await prisma.message.findMany({
    ...prismaArgs,
    where: { institutionId },
    include: {
      sender: { select: { id: true, username: true, role: true } },
      attachments: true,
    },
    orderBy: { createdAt: "desc" },
  });

  if (query.cursor) meta.nextCursor = computeNextCursor(messages as any);
  return { data: messages, meta };
};

// ─────────────────────────────────────────────────────────────
// ✅ Mark messages as read (idempotent)
// ─────────────────────────────────────────────────────────────
export const markMessagesRead = async (payload: MarkReadPayload) => {
  const { messageIds, userId } = payload;
  if (!Array.isArray(messageIds) || messageIds.length === 0)
    throw Errors.Validation("Message IDs required");

  await prisma.readReceipt.createMany({
    data: messageIds.map((messageId) => ({
      messageId,
      userId,
    })),
    skipDuplicates: true, // idempotent operation
  });

  logger.info(`✅ User ${userId} marked ${messageIds.length} messages as read`);
  return { success: true };
};

// ─────────────────────────────────────────────────────────────
// 🗑️ Soft delete a message
// ─────────────────────────────────────────────────────────────
export const deleteMessage = async (messageId: string, requesterId: string) => {
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) throw Errors.NotFound("Message not found");

  // Only sender or admin can delete
  if (message.senderId !== requesterId) {
    const user = await prisma.user.findUnique({ where: { id: requesterId } });
    if (!user || user.role !== "admin") throw Errors.Forbidden("Not authorized to delete message");
  }

  const deleted = await prisma.message.update({
    where: { id: messageId },
    data: { deleted: true },
  });

  logger.warn(`🗑️ Message ${messageId} soft-deleted by ${requesterId}`);
  return deleted;
};

// ─────────────────────────────────────────────────────────────
// 🔍 Get unread messages count for a user
// ─────────────────────────────────────────────────────────────
export const getUnreadCount = async (userId: string) => {
  const count = await prisma.message.count({
    where: {
      recipientId: userId,
      deleted: false,
      readReceipts: { none: { userId } },
    },
  });
  return { unreadCount: count };
};

// ─────────────────────────────────────────────────────────────
// ⚙️ Search messages (content or sender/recipient username)
// ─────────────────────────────────────────────────────────────
export const searchMessages = async (userId: string, query: string, limit = 20) => {
  if (!query.trim()) return [];

  const results = await prisma.message.findMany({
    where: {
      OR: [
        { content: { contains: query, mode: "insensitive" } },
        {
          sender: {
            username: { contains: query, mode: "insensitive" },
          },
        },
        {
          recipient: {
            username: { contains: query, mode: "insensitive" },
          },
        },
      ],
      OR: [{ senderId: userId }, { recipientId: userId }],
    },
    take: limit,
    orderBy: { createdAt: "desc" },
    include: {
      sender: { select: { id: true, username: true } },
      recipient: { select: { id: true, username: true } },
    },
  });

  return results;
};

// ─────────────────────────────────────────────────────────────
// 🚀 Future integration points
// ─────────────────────────────────────────────────────────────
//  - notificationService.enqueueNewMessage(message)
//  - websocketGateway.broadcastMessage(conversationId, message)
//  - AI summarization or moderation (lib/ai/aiClient.ts)
//  - message analytics tracking (workers/analytics.worker.ts)