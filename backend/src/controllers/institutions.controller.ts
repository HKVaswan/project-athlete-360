import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";

// Helper → generate unique institution code
const generateInstitutionCode = () => `INST-${Math.floor(1000 + Math.random() * 9000)}`;

// ───────────────────────────────
// 🏫 Create Institution (Admin only)
export const createInstitution = async (req: Request, res: Response) => {
  try {
    const { name, address, contactEmail, contactNumber, adminId } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: "Institution name is required" });
    }

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

    res.status(201).json({
      success: true,
      message: "Institution created successfully",
      data: institution,
    });
  } catch (err) {
    logger.error("❌ createInstitution failed: " + err);
    res.status(500).json({ success: false, message: "Failed to create institution" });
  }
};

// ───────────────────────────────
// 📋 List All Institutions
export const listInstitutions = async (_req: Request, res: Response) => {
  try {
    const institutions = await prisma.institution.findMany({
      include: {
        coaches: {
          include: { coach: { select: { id: true, username: true, name: true, email: true } } },
        },
        athletes: {
          select: { id: true, name: true, sport: true, approved: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: institutions });
  } catch (err) {
    logger.error("❌ listInstitutions failed: " + err);
    res.status(500).json({ success: false, message: "Failed to fetch institutions" });
  }
};

// ───────────────────────────────
// 👨‍🏫 Link Coach to Institution
export const linkCoachToInstitution = async (req: Request, res: Response) => {
  try {
    const { coachId, institutionCode } = req.body;

    if (!coachId || !institutionCode) {
      return res.status(400).json({
        success: false,
        message: "Both coachId and institutionCode are required",
      });
    }

    const institution = await prisma.institution.findUnique({
      where: { code: institutionCode },
    });

    if (!institution) {
      return res.status(404).json({
        success: false,
        message: "Institution not found",
      });
    }

    // Link coach
    const link = await prisma.coachInstitution.create({
      data: {
        coach: { connect: { id: coachId } },
        institution: { connect: { id: institution.id } },
      },
    });

    res.json({
      success: true,
      message: "Coach linked to institution successfully",
      data: link,
    });
  } catch (err) {
    logger.error("❌ linkCoachToInstitution failed: " + err);
    res.status(500).json({ success: false, message: "Failed to link coach to institution" });
  }
};

// ───────────────────────────────
// 🧍 Student (Athlete) joins via institution + coach code
export const requestAthleteJoin = async (req: Request, res: Response) => {
  try {
    const { userId, institutionCode } = req.body;

    if (!userId || !institutionCode) {
      return res.status(400).json({
        success: false,
        message: "userId and institutionCode are required",
      });
    }

    const institution = await prisma.institution.findUnique({
      where: { code: institutionCode },
    });

    if (!institution) {
      return res.status(404).json({ success: false, message: "Invalid institution code" });
    }

    // Create athlete profile (pending approval)
    const athlete = await prisma.athlete.create({
      data: {
        user: { connect: { id: userId } },
        name: "New Athlete",
        athleteCode: `ATH-${Math.floor(1000 + Math.random() * 9000)}`,
        institution: { connect: { id: institution.id } },
        approved: false,
      },
    });

    res.status(201).json({
      success: true,
      message: "Athlete registration requested successfully. Awaiting approval.",
      data: athlete,
    });
  } catch (err) {
    logger.error("❌ requestAthleteJoin failed: " + err);
    res.status(500).json({ success: false, message: "Failed to request athlete join" });
  }
};

// ───────────────────────────────
// ✅ Approve or Reject Athlete
export const updateAthleteApproval = async (req: Request, res: Response) => {
  try {
    const { athleteId, approverId, approved } = req.body;

    if (!athleteId || approved === undefined) {
      return res.status(400).json({
        success: false,
        message: "athleteId and approved status are required",
      });
    }

    const athlete = await prisma.athlete.update({
      where: { id: athleteId },
      data: {
        approved,
        approvedBy: approved ? approverId : null,
      },
    });

    res.json({
      success: true,
      message: approved
        ? "Athlete approved and added to the institution."
        : "Athlete request rejected.",
      data: athlete,
    });
  } catch (err) {
    logger.error("❌ updateAthleteApproval failed: " + err);
    res.status(500).json({ success: false, message: "Failed to update athlete approval" });
  }
};

// ───────────────────────────────
// 🧾 Get Single Institution Detail
export const getInstitutionById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const institution = await prisma.institution.findUnique({
      where: { id },
      include: {
        coaches: {
          include: { coach: { select: { id: true, name: true, username: true, email: true } } },
        },
        athletes: {
          include: { user: { select: { username: true, email: true } } },
        },
        competitions: true,
      },
    });

    if (!institution) {
      return res.status(404).json({ success: false, message: "Institution not found" });
    }

    res.json({ success: true, data: institution });
  } catch (err) {
    logger.error("❌ getInstitutionById failed: " + err);
    res.status(500).json({ success: false, message: "Failed to fetch institution details" });
  }
};