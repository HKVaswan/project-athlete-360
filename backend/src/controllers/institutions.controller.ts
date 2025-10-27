// src/controllers/institutions.controller.ts
import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";
import { Prisma } from "@prisma/client";

// Helper → generate unique institution code
const generateInstitutionCode = () => `INST-${Math.floor(1000 + Math.random() * 9000)}`;

// ───────────────────────────────
// 🏫 Create Institution (Admin only)
// ───────────────────────────────
export const createInstitution = async (req: Request, res: Response) => {
  try {
    const { name, address, contactEmail, contactNumber } = req.body;
    const adminId = (req as any).userId;
    const role = (req as any).role;

    if (!name) return res.status(400).json({ success: false, message: "Institution name is required" });
    if (!["admin"].includes(role)) return res.status(403).json({ success: false, message: "Only admins can create institutions" });

    const code = generateInstitutionCode();

    const institution = await prisma.institution.create({
      data: {
        name,
        address,
        code,
        contactEmail,
        contactNumber,
        admin: adminId ? { connect: { id: adminId } } : undefined,
      },
    });

    logger.info(`🏫 Institution created: ${institution.name} (${institution.code})`);

    res.status(201).json({
      success: true,
      message: "Institution created successfully",
      data: institution,
    });
  } catch (err: any) {
    logger.error("❌ createInstitution failed: " + err.message || err);
    res.status(500).json({ success: false, message: "Failed to create institution" });
  }
};

// ───────────────────────────────
// 📋 List All Institutions (with search & pagination)
// /api/institutions?search=academy&page=1&limit=10
// ───────────────────────────────
export const listInstitutions = async (req: Request, res: Response) => {
  try {
    const { search, page, limit } = req.query;
    const take = Math.min(Number(limit) || 10, 50);
    const skip = page ? (Number(page) - 1) * take : 0;

    const where: Prisma.InstitutionWhereInput = search
      ? { name: { contains: String(search), mode: "insensitive" } }
      : {};

    const [institutions, total] = await Promise.all([
      prisma.institution.findMany({
        where,
        include: {
          coaches: {
            include: {
              coach: { select: { id: true, username: true, name: true, email: true } },
            },
          },
          athletes: {
            select: { id: true, name: true, sport: true, approved: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.institution.count({ where }),
    ]);

    // Add basic stats for UI
    const enriched = institutions.map((inst) => ({
      ...inst,
      stats: {
        totalAthletes: inst.athletes.length,
        approvedAthletes: inst.athletes.filter((a) => a.approved).length,
        totalCoaches: inst.coaches.length,
      },
    }));

    res.json({
      success: true,
      data: enriched,
      meta: {
        total,
        page: Number(page) || 1,
        limit: take,
        totalPages: Math.ceil(total / take),
      },
    });
  } catch (err: any) {
    logger.error("❌ listInstitutions failed: " + err.message || err);
    res.status(500).json({ success: false, message: "Failed to fetch institutions" });
  }
};

// ───────────────────────────────
// 👨‍🏫 Link Coach to Institution (admin only)
// ───────────────────────────────
export const linkCoachToInstitution = async (req: Request, res: Response) => {
  try {
    const { coachId, institutionCode } = req.body;
    const role = (req as any).role;

    if (!coachId || !institutionCode)
      return res.status(400).json({ success: false, message: "coachId and institutionCode are required" });
    if (!["admin"].includes(role))
      return res.status(403).json({ success: false, message: "Only admin can link coaches to institutions" });

    const institution = await prisma.institution.findUnique({ where: { code: institutionCode } });
    if (!institution) return res.status(404).json({ success: false, message: "Institution not found" });

    const existingLink = await prisma.coachInstitution.findFirst({
      where: { coachId, institutionId: institution.id },
    });
    if (existingLink)
      return res.status(400).json({ success: false, message: "Coach already linked to this institution" });

    const link = await prisma.coachInstitution.create({
      data: {
        coach: { connect: { id: coachId } },
        institution: { connect: { id: institution.id } },
      },
    });

    logger.info(`👨‍🏫 Coach ${coachId} linked to institution ${institution.name}`);
    res.json({ success: true, message: "Coach linked successfully", data: link });
  } catch (err: any) {
    logger.error("❌ linkCoachToInstitution failed: " + err.message || err);
    res.status(500).json({ success: false, message: "Failed to link coach" });
  }
};

// ───────────────────────────────
// 🧍 Athlete joins via institution code (self-registration)
// ───────────────────────────────
export const requestAthleteJoin = async (req: Request, res: Response) => {
  try {
    const { userId, institutionCode } = req.body;

    if (!userId || !institutionCode)
      return res.status(400).json({ success: false, message: "userId and institutionCode are required" });

    const institution = await prisma.institution.findUnique({ where: { code: institutionCode } });
    if (!institution)
      return res.status(404).json({ success: false, message: "Invalid institution code" });

    const existing = await prisma.athlete.findUnique({ where: { userId } });
    if (existing)
      return res.status(400).json({ success: false, message: "User already has an athlete profile" });

    const athlete = await prisma.athlete.create({
      data: {
        user: { connect: { id: userId } },
        name: "New Athlete",
        athleteCode: `ATH-${Math.floor(1000 + Math.random() * 9000)}`,
        institution: { connect: { id: institution.id } },
        approved: false,
      },
    });

    logger.info(`📝 Athlete join request submitted for institution ${institution.name}`);
    res.status(201).json({
      success: true,
      message: "Athlete join request submitted. Awaiting coach approval.",
      data: athlete,
    });
  } catch (err: any) {
    logger.error("❌ requestAthleteJoin failed: " + err.message || err);
    res.status(500).json({ success: false, message: "Failed to process join request" });
  }
};

// ───────────────────────────────
// ✅ Approve / Reject Athlete (coach or admin)
// ───────────────────────────────
export const updateAthleteApproval = async (req: Request, res: Response) => {
  try {
    const { athleteId, approved } = req.body;
    const approverId = (req as any).userId;
    const role = (req as any).role;

    if (!athleteId || approved === undefined)
      return res.status(400).json({ success: false, message: "athleteId and approved are required" });
    if (!["coach", "admin"].includes(role))
      return res.status(403).json({ success: false, message: "Only coach or admin can approve athletes" });

    const athlete = await prisma.athlete.findUnique({ where: { id: athleteId } });
    if (!athlete) return res.status(404).json({ success: false, message: "Athlete not found" });

    const updated = await prisma.athlete.update({
      where: { id: athleteId },
      data: { approved, approvedBy: approved ? approverId : null, approvedAt: approved ? new Date() : null },
    });

    logger.info(
      approved
        ? `✅ Athlete ${updated.name} approved by ${role} (${approverId})`
        : `🚫 Athlete ${updated.name} rejected by ${role} (${approverId})`
    );

    res.json({
      success: true,
      message: approved ? "Athlete approved successfully" : "Athlete rejected",
      data: updated,
    });
  } catch (err: any) {
    logger.error("❌ updateAthleteApproval failed: " + err.message || err);
    res.status(500).json({ success: false, message: "Failed to update athlete approval" });
  }
};

// ───────────────────────────────
// 🧾 Get Single Institution Detail (with coaches, athletes, competitions)
// ───────────────────────────────
export const getInstitutionById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const institution = await prisma.institution.findUnique({
      where: { id },
      include: {
        coaches: {
          include: {
            coach: { select: { id: true, name: true, username: true, email: true } },
          },
        },
        athletes: {
          include: {
            user: { select: { username: true, email: true } },
          },
        },
        competitions: true,
      },
    });

    if (!institution)
      return res.status(404).json({ success: false, message: "Institution not found" });

    const stats = {
      totalAthletes: institution.athletes.length,
      approvedAthletes: institution.athletes.filter((a) => a.approved).length,
      totalCoaches: institution.coaches.length,
    };

    res.json({ success: true, data: { ...institution, stats } });
  } catch (err: any) {
    logger.error("❌ getInstitutionById failed: " + err.message || err);
    res.status(500).json({ success: false, message: "Failed to fetch institution details" });
  }
};