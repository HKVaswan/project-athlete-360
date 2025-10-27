import express from "express";
import { createInstitution, listInstitutions } from "../controllers/institutions.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = express.Router();

router.post("/", requireAuth, createInstitution);
router.get("/", listInstitutions);

export default router;