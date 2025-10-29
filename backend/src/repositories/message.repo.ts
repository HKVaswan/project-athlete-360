import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Message Repository
 * ------------------------------------------------------------
 * Provides data access for messaging between athletes, coaches, and admins.
 * Supports:
 *  - Direct and group messaging
 *  - Attachments
 *  - Pagination for chat threads
 *  - Read receipts and message states
 */
export const MessageRepo = {
  /**
   * Create a new message in a thread or start a new thread.
   */
  async createMessage(data: {
    senderId: string;
    receiverId?: string;
    threadId?: string;
    content?: string;
    attachmentUrl?: string | null;
  }) {
    try {
      const message = await prisma.message.create({
        data: {
          senderId: data.senderId,
          receiverId: data.receiverId,
          threadId: data.threadId,
          content: data.content ?? "",
          attachmentUrl: data.attachmentUrl ?? null,
        },
        include: {
          sender: { select: { id: true, name: true, role: true } },
          receiver: { select: { id: true, name: true, role: true } },
        },
      });
      return message;
    } catch (error) {
      console.error("❌ Error creating message:", error);
      throw new Error("Failed to create message");
    }
  },

  /**
   * Fetch messages for a specific thread (with pagination).
   */
  async getMessagesByThread(threadId: string, page = 1, limit = 20) {
    try {
      const skip = (page - 1) * limit;

      const [messages, total] = await Promise.all([
        prisma.message.findMany({
          where: { threadId },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
          include: {
            sender: { select: { id: true, name: true, role: true } },
            receiver: { select: { id: true, name: true, role: true } },
          },
        }),
        prisma.message.count({ where: { threadId } }),
      ]);

      return {
        messages: messages.reverse(),
        pagination: {
          total,
          page,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      console.error("❌ Error fetching messages:", error);
      throw new Error("Failed to fetch messages");
    }
  },

  /**
   * Get all threads for a user (athlete, coach, or admin).
   */
  async getUserThreads(userId: string) {
    try {
      const threads = await prisma.messageThread.findMany({
        where: {
          participants: {
            some: { userId },
          },
        },
        include: {
          participants: {
            include: {
              user: { select: { id: true, name: true, role: true } },
            },
          },
          lastMessage: {
            include: {
              sender: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { updatedAt: "desc" },
      });

      return threads;
    } catch (error) {
      console.error("❌ Error fetching user threads:", error);
      throw new Error("Failed to load user threads");
    }
  },

  /**
   * Mark a message as read by a user.
   */
  async markAsRead(messageId: string, userId: string) {
    try {
      await prisma.messageReadReceipt.upsert({
        where: {
          messageId_userId: { messageId, userId },
        },
        update: { readAt: new Date() },
        create: { messageId, userId, readAt: new Date() },
      });
      return { success: true };
    } catch (error) {
      console.error("❌ Error marking message as read:", error);
      throw new Error("Failed to mark message as read");
    }
  },

  /**
   * Delete a message (soft delete for safety).
   */
  async deleteMessage(messageId: string, userId: string) {
    try {
      const existing = await prisma.message.findUnique({ where: { id: messageId } });
      if (!existing) throw new Error("Message not found");
      if (existing.senderId !== userId) throw new Error("Unauthorized delete attempt");

      await prisma.message.update({
        where: { id: messageId },
        data: { deleted: true },
      });

      return { success: true };
    } catch (error) {
      console.error("❌ Error deleting message:", error);
      throw new Error("Failed to delete message");
    }
  },
};