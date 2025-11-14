// src/services/mfa.service.ts
import prisma from "../prismaClient";
import { addMinutes } from "date-fns";
import { v4 as uuidv4 } from "uuid";

export const generateMfaToken = async (userId: string) => {
  const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit
  const expiresAt = addMinutes(new Date(), 5);

  const challenge = await prisma.mfaChallenge.create({
    data: {
      userId,
      code,
      expiresAt,
      consumed: false,
    },
  });

  return { id: challenge.id, code, expiresIn: 5 * 60 }; // controller may send code to user via email/SMS
};

export const verifyMfaCode = async (userId: string, code: string) => {
  const row = await prisma.mfaChallenge.findFirst({
    where: {
      userId,
      code,
      consumed: false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!row) return false;

  await prisma.mfaChallenge.update({ where: { id: row.id }, data: { consumed: true } });
  return true;
};