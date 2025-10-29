/**
 * src/routes/invitations.ts
 * ------------------------------------------------------------
 * Handles user invitations (for athletes, coaches, or admins)
 * Secure, token-based flow:
 *  1. Admin/Institution sends invitation (email + token)
 *  2. Invitee accepts using token -> creates account or links existing one
 */

import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/roles.middleware";
import { validate } from "../middleware/validation.middleware";
import * as invitationController from "../controllers/invitations.controller";
import {
  createInvitationSchema,
  acceptInvitationSchema,
} from "../validators/invitations.validator";

const router = Router();

/**
 * 🔒 All invitation routes are protected
 */
router.use(requireAuth);

/**
 * ➕ Create a new invitation
 * Accessible by: Admin, Institution Admin
 */
router.post(
  "/",
  requireRole(["admin", "institution"]),
  validate(createInvitationSchema),
  invitationController.createInvitation
);

/**
 * 📋 List all pending invitations for the institution or system
 */
router.get("/", requireRole(["admin", "institution"]), invitationController.listInvitations);

/**
 * 🔍 Get invitation details by token
 */
router.get("/token/:token", invitationController.getInvitationByToken);

/**
 * ✅ Accept invitation
 * - Verifies token
 * - Creates or links user
 */
router.post(
  "/accept",
  validate(acceptInvitationSchema),
  invitationController.acceptInvitation
);

/**
 * ❌ Revoke invitation
 * Accessible by: Admin or Institution Admin
 */
router.delete("/:id", requireRole(["admin", "institution"]), invitationController.revokeInvitation);

export default router;