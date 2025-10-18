// src/services/user.service.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function getUserProfile(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      username: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      updatedAt: true,
      athlete: {
        select: {
          id: true,
          athleteId: true,
          sport: true,
          gender: true,
        },
      },
    },
  });
}

export async function findByUsername(username: string) {
  return prisma.user.findUnique({ where: { username } });
}

export async function findByEmail(email: string) {
  return prisma.user.findUnique({ where: { email } });
}
