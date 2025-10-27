import { Request, Response } from "express";
import prisma from "../prismaClient";
import logger from "../logger";

const generateInstitutionCode = () => {
  return `INST-${Math.floor(1000 + Math.random() * 9000)}`;
};

// Create institution (admin only — enforce in route/middleware)
export const createInstitution = async (req: Request, res: Response) => {
  try {
    const { name, address } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "Name required" });

    const institution = await prisma.institution.create({
      data: {
        name,
        address,
        institutionCode: generateInstitutionCode(),
      },
    });

    return res.status(201).json({ success: true, data: institution });
  } catch (err) {
    logger.error("createInstitution failed: " + err);
    return res.status(500).json({ success: false, message: "Failed to create institution" });
  }
};

// optional: list institutions
export const listInstitutions = async (_req: Request, res: Response) => {
  try {
    const list = await prisma.institution.findMany({ orderBy: { createdAt: "desc" } });
    return res.json({ success: true, data: list });
  } catch (err) {
    logger.error("listInstitutions failed: " + err);
    return res.status(500).json({ success: false, message: "Failed to fetch institutions" });
  }
};