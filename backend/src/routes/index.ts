import { Router } from "express";
import authRoutes from "./auth";
import usersRoutes from "./users";
import athletesRoutes from "./athletes";
import sessionsRoutes from "./sessions";
import trainingSessionsRoutes from "./trainingSessions";
import assessmentsRoutes from "./assessments";
import performanceRoutes from "./performance";
import attendanceRoutes from "./attendance";
import injuriesRoutes from "./injuries";

const router = Router();

router.use("/auth", authRoutes);
router.use("/users", usersRoutes);
router.use("/athletes", athletesRoutes);
router.use("/sessions", sessionsRoutes);
router.use("/training-sessions", trainingSessionsRoutes);
router.use("/assessments", assessmentsRoutes);
router.use("/performance", performanceRoutes);
router.use("/attendance", attendanceRoutes);
router.use("/injuries", injuriesRoutes);

export default router;
