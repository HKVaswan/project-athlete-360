/**
 * user.repo.ts
 * ---------------------------------------------------------------------
 * Centralized data access for all user-related operations (admin, coach, athlete).
 * Handles CRUD, lookups, role-based queries, and account state updates.
 *
 * ⚙️  Enterprise-grade features:
 *  - Strict TypeScript typing for data safety
 *  - Graceful error handling using ApiError
 *  - Prisma transaction safety
 *  - Optimized for reuse in services
 */

import { Prisma, User } from "@prisma/client";
import prisma from "../prismaClient";
import { ApiError, Errors } from "../utils/errors";

export class UserRepository {
  /**
   * Create a new user (athlete, coach, or admin)
   */
  async createUser(data: Prisma.UserCreateInput): Promise<User> {
    try {
      return await prisma.user.create({ data });
    } catch (err: any) {
      if (err.code === "P2002") {
        throw Errors.Duplicate("Email or username already exists");
      }
      throw Errors.Server("Error creating user");
    }
  }

  /**
   * Find user by unique identifier (id, email, or username)
   */
  async findByUnique(where: Prisma.UserWhereUniqueInput): Promise<User | null> {
    return prisma.user.findUnique({ where });
  }

  /**
   * Find user by ID (throws error if not found)
   */
  async findByIdOrThrow(id: string): Promise<User> {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw Errors.NotFound("User not found");
    return user;
  }

  /**
   * Find all users with optional filters
   */
  async findAll(filters?: Prisma.UserWhereInput): Promise<User[]> {
    return prisma.user.findMany({
      where: filters,
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Update user details
   */
  async updateUser(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    try {
      return await prisma.user.update({
        where: { id },
        data,
      });
    } catch (err: any) {
      if (err.code === "P2025") throw Errors.NotFound("User not found");
      throw Errors.Server("Error updating user");
    }
  }

  /**
   * Delete user (soft delete preferred)
   */
  async deleteUser(id: string, softDelete = true): Promise<User> {
    if (softDelete) {
      return prisma.user.update({
        where: { id },
        data: { isActive: false },
      });
    }
    return prisma.user.delete({ where: { id } });
  }

  /**
   * Verify user credentials (used by auth service)
   */
  async verifyCredentials(email: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        password: true,
        username: true,
        role: true,
        isActive: true,
      },
    });
  }

  /**
   * Check if an institution admin exists
   */
  async adminExistsForInstitution(institutionId: string): Promise<boolean> {
    const admin = await prisma.user.findFirst({
      where: { institutionId, role: "ADMIN" },
    });
    return !!admin;
  }

  /**
   * List all coaches or athletes under a given institution
   */
  async findByInstitution(
    institutionId: string,
    role?: "COACH" | "ATHLETE"
  ): Promise<User[]> {
    return prisma.user.findMany({
      where: {
        institutionId,
        ...(role ? { role } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Deactivate all users under an institution (for plan downgrade, etc.)
   */
  async deactivateInstitutionUsers(institutionId: string): Promise<number> {
    const result = await prisma.user.updateMany({
      where: { institutionId },
      data: { isActive: false },
    });
    return result.count;
  }

  /**
   * Check system load (approximate active user count)
   */
  async getActiveUserCount(): Promise<number> {
    return prisma.user.count({
      where: { isActive: true },
    });
  }

  /**
   * Search users (autocomplete support)
   */
  async searchUsers(query: string, limit = 10): Promise<User[]> {
    return prisma.user.findMany({
      where: {
        OR: [
          { username: { contains: query, mode: "insensitive" } },
          { email: { contains: query, mode: "insensitive" } },
        ],
      },
      take: limit,
      orderBy: { createdAt: "desc" },
    });
  }
}

export const userRepository = new UserRepository();