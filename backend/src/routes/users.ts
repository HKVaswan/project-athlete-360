// src/routes/users.ts
import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/roles.middleware";
import {
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  getProfile,
  updateProfile,
  updatePassword,
} from "../controllers/users.controller";

const router = Router();

// Admin: list all users
router.get("/", requireAuth, requireRole("admin"), getAllUsers);

// Admin: view specific user
router.get("/:id", requireAuth, requireRole("admin"), getUserById);

// Admin: delete user
router.delete("/:id", requireAuth, requireRole("admin"), deleteUser);

// Admin: edit user role or details
router.put("/:id", requireAuth, requireRole("admin"), updateUser);

// Athlete/Coach: own profile
router.get("/:id/profile", requireAuth, getProfile);
router.put("/:id/profile", requireAuth, updateProfile);

// Change password (Settings page)
router.put("/:id/password", requireAuth, updatePassword);

export default router;
