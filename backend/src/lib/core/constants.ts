/**
 * src/lib/core/constants.ts
 * ------------------------------------------------------------------
 * Centralized constants and enums used across the backend.
 * Ensures consistent references, cleaner imports, and
 * global scalability (future-proofing).
 */

export const SYSTEM_NAME = "Project Athlete 360";
export const PLATFORM_VERSION = "1.0.0";
export const ORGANIZATION = "PA360 Global Sports Systems";

/* ------------------------------------------------------------------
 * 🌍 User Roles & Permissions
 * ------------------------------------------------------------------ */
export enum UserRole {
  SUPER_ADMIN = "super_admin",     // System-level owner (you)
  ADMIN = "admin",                 // Institution-level admin
  COACH = "coach",
  ATHLETE = "athlete",
}

/**
 * Role hierarchy — useful for role-based access control
 */
export const ROLE_HIERARCHY: Record<UserRole, number> = {
  [UserRole.SUPER_ADMIN]: 4,
  [UserRole.ADMIN]: 3,
  [UserRole.COACH]: 2,
  [UserRole.ATHLETE]: 1,
};

/* ------------------------------------------------------------------
 * 📈 AI Models & Capabilities
 * ------------------------------------------------------------------ */
export const AI_MODELS = {
  PERFORMANCE_FORECAST: "ai-performance-forecast-v1",
  WELLNESS_MONITOR: "ai-wellness-monitor-v1",
  SELF_LEARNING: "ai-self-learning-core",
  COACH_ASSISTANT: "ai-coach-assistant-v1",
  INJURY_PREVENTION: "ai-injury-prevention-v2",
};

export const AI_CONFIDENCE_THRESHOLD = 0.75; // Minimum acceptable confidence level
export const AI_RETRAIN_INTERVAL_HOURS = 24;

/* ------------------------------------------------------------------
 * ⚙️ System-Level Constants
 * ------------------------------------------------------------------ */
export const SYSTEM_LIMITS = {
  MAX_FILE_SIZE_MB: 50,
  MAX_CONCURRENT_SESSIONS: 10,
  MAX_LOGIN_ATTEMPTS: 5,
  PASSWORD_RESET_EXPIRY_HOURS: 2,
};

export const EMAIL_TEMPLATES = {
  INVITATION: "invitation",
  PASSWORD_RESET: "passwordReset",
  SESSION_REMINDER: "sessionReminder",
};

/* ------------------------------------------------------------------
 * 📡 Event Names (aligned with EventBus)
 * ------------------------------------------------------------------ */
export const EVENTS = {
  USER_CREATED: "user.created",
  USER_DELETED: "user.deleted",
  ATHLETE_PERFORMANCE_UPDATED: "athlete.performance.updated",
  SESSION_COMPLETED: "session.completed",
  RESOURCE_UPLOADED: "resource.uploaded",
  AI_ALERT_TRIGGERED: "ai.alert.triggered",
  SYSTEM_ERROR_REPORTED: "system.error.reported",
};

/* ------------------------------------------------------------------
 * 🔒 Security & Compliance
 * ------------------------------------------------------------------ */
export const SECURITY_CONSTANTS = {
  PASSWORD_SALT_ROUNDS: 12,
  TOKEN_EXPIRY_HOURS: 12,
  REFRESH_TOKEN_EXPIRY_DAYS: 7,
  JWT_ALGORITHM: "HS512",
  MAX_FAILED_LOGIN_ATTEMPTS: 5,
  LOCK_DURATION_MINUTES: 30,
};

/* ------------------------------------------------------------------
 * 💬 Notification Channels
 * ------------------------------------------------------------------ */
export const NOTIFICATION_CHANNELS = {
  EMAIL: "email",
  IN_APP: "in_app",
  PUSH: "push",
  SMS: "sms",
};

/* ------------------------------------------------------------------
 * 🧠 AI Alert Severity Levels
 * ------------------------------------------------------------------ */
export const ALERT_SEVERITY = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
};

/* ------------------------------------------------------------------
 * 🧩 Miscellaneous Constants
 * ------------------------------------------------------------------ */
export const TIMEZONES = [
  "Asia/Kolkata",
  "Europe/London",
  "America/New_York",
  "Asia/Tokyo",
  "Australia/Sydney",
];

export const SPORTS = [
  "Athletics",
  "Badminton",
  "Cricket",
  "Football",
  "Hockey",
  "Swimming",
  "Wrestling",
  "Boxing",
  "Kabaddi",
  "Shooting",
];

export const DEFAULT_PROFILE_IMAGE =
  "https://cdn.pa360.net/defaults/profile-placeholder.png";

/* ------------------------------------------------------------------
 * 🚀 Export all
 * ------------------------------------------------------------------ */
export default {
  SYSTEM_NAME,
  PLATFORM_VERSION,
  ORGANIZATION,
  UserRole,
  ROLE_HIERARCHY,
  AI_MODELS,
  SYSTEM_LIMITS,
  EMAIL_TEMPLATES,
  EVENTS,
  SECURITY_CONSTANTS,
  NOTIFICATION_CHANNELS,
  ALERT_SEVERITY,
  TIMEZONES,
  SPORTS,
  DEFAULT_PROFILE_IMAGE,
};