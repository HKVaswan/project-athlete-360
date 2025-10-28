/**
 * src/controllers/athletes.controller.ts
 * --------------------------------------------------------------------
 * Enterprise-grade athlete controller.
 * Handles:
 * - Athlete profile management
 * - Institution + coach linkage
 * - Secure role-based access
 * - Pagination for large athlete lists
 * - Integration hooks for sessions/performance
 */

import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";
import { Errors, sendErrorResponse } from "../utils/errors";
import { paginate } from "../utils/pagination";

/* ------------------------------------------------------------------
   🆕 Create Athlete (admin/coach)
-------------------------------------------------------------------*/
export const createAthlete = async (req: Request, res: Response) => {
  try {
    const { name, age, sport, gender, institutionId, coachId } = req.body;
    const requester = req.user;

    if (!requester) throw Errors.Auth("Unauthorized");
    if (!name || !sport || !institutionId)
      throw Errors.Validation("Missing required fields");

    // Ensure requester has rights under this institution
    if (requester.role !== "admin" && requester.role !== "coach")
      throw Errors.Forbidden("Access denied");

    const institution = await prisma.institution.findUnique({
      where: { id: institutionId },
    });
    if (!institution) throw Errors.NotFound("Institution not found");

    // If coach adding athlete, verify institution match
    if (requester.role === "coach" && requester.institutionId !== institutionId)
      throw Errors.Forbidden("Cannot add athletes to another institution");

    const athlete = await prisma.athlete.create({
      data: {
        name,
        age: Number(age) || null,
        gender,
        sport,
        institutionId,
        coachId: coachId || null,
        createdById: requester.id,
      },
    });

    res.status(201).json({
      success: true,
      message: "Athlete created successfully.",
      data: athlete,
    });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   📋 Get All Athletes (paginated, role-safe)
-------------------------------------------------------------------*/
export const getAthletes = async (req: Request, res: Response) => {
  try {
    const requester = req.user;
    if (!requester) throw Errors.Auth("Unauthorized");

    let where: any = {};

    if (requester.role === "admin") {
      where.institutionId = requester.institutionId;
    } else if (requester.role === "coach") {
      where.coachId = requester.id;
    } else {
      throw Errors.Forbidden("Access denied");
    }

    const { prismaArgs, meta } = await paginate(req.query, "offset", {
      where,
      countFn: (w) => prisma.athlete.count({ where: w }),
      includeTotal: true,
    });

    const athletes = await prisma.athlete.findMany({
      ...prismaArgs,
      where,
      include: {
        coach: { select: { id: true, name: true } },
        institution: { select: { id: true, name: true } },
      },
    });

    res.json({ success: true, data: athletes, meta });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   🔍 Get Athlete by ID
-------------------------------------------------------------------*/
export const getAthleteById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const requester = req.user;
    if (!requester) throw Errors.Auth("Unauthorized");

    const athlete = await prisma.athlete.findUnique({
      where: { id },
      include: {
        coach: { select: { id: true, name: true } },
        institution: { select: { id: true, name: true } },
        performances: { take: 5, orderBy: { date: "desc" } },
      },
    });

    if (!athlete) throw Errors.NotFound("Athlete not found");

    // Restrict access if outside institution or coach relationship
    if (
      requester.role === "coach" &&
      athlete.coachId !== requester.id
    ) {
      throw Errors.Forbidden("Access denied");
    }
    if (
      requester.role === "admin" &&
      athlete.institutionId !== requester.institutionId
    ) {
      throw Errors.Forbidden("Access denied");
    }

    res.json({ success: true, data: athlete });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   ✏️ Update Athlete Info (coach/admin only)
-------------------------------------------------------------------*/
export const updateAthlete = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const requester = req.user;
    if (!requester) throw Errors.Auth("Unauthorized");

    const existing = await prisma.athlete.findUnique({ where: { id } });
    if (!existing) throw Errors.NotFound("Athlete not found");

    // Access control
    if (
      requester.role === "coach" &&
      existing.coachId !== requester.id
    ) {
      throw Errors.Forbidden("You can only update your own athletes");
    }

    const updates = req.body;
    delete updates.id;
    delete updates.institutionId; // cannot modify

    const athlete = await prisma.athlete.update({
      where: { id },
      data: updates,
    });

    logger.info(`Athlete ${id} updated by ${requester.id}`);
    res.json({ success: true, data: athlete });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   🔗 Assign / Change Coach (admin-only)
-------------------------------------------------------------------*/
export const assignCoach = async (req: Request, res: Response) => {
  try {
    const { athleteId, coachId } = req.body;
    const requester = req.user;

    if (!requester || requester.role !== "admin")
      throw Errors.Forbidden("Admin access required");

    const athlete = await prisma.athlete.findUnique({ where: { id: athleteId } });
    if (!athlete) throw Errors.NotFound("Athlete not found");

    const coach = await prisma.coach.findUnique({ where: { id: coachId } });
    if (!coach) throw Errors.NotFound("Coach not found");

    // Prevent cross-institution assignment
    if (athlete.institutionId !== coach.institutionId)
      throw Errors.Validation("Coach and athlete belong to different institutions");

    const updated = await prisma.athlete.update({
      where: { id: athleteId },
      data: { coachId },
    });

    res.json({ success: true, message: "Coach assigned successfully", data: updated });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};

/* ------------------------------------------------------------------
   🗑️ Delete Athlete (admin only)
-------------------------------------------------------------------*/
export const deleteAthlete = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const requester = req.user;
    if (!requester || requester.role !== "admin")
      throw Errors.Forbidden("Admin access required");

    await prisma.athlete.delete({ where: { id } });
    logger.warn(`Athlete ${id} deleted by admin ${requester.id}`);

    res.json({ success: true, message: "Athlete deleted successfully" });
  } catch (err: any) {
    sendErrorResponse(res, err);
  }
};