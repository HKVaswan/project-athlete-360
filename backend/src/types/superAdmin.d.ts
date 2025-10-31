/**
 * src/types/superAdmin.d.ts
 * ----------------------------------------------------------------------
 * 🧠 Global Type Declarations for Super Admin Module
 *
 * Purpose:
 *  - Provide consistent typing across controllers, services, and repos.
 *  - Avoid circular imports between modules.
 *  - Enhance code readability and maintainability.
 */

import type { Request } from "express";

/* -----------------------------------------------------------------------
   🧩 Super Admin Request Context
------------------------------------------------------------------------*/
export interface SuperAdminRequest extends Request {
  user: {
    id: string;
    username: string;
    email: string;
    role: "super_admin";
    mfaVerified?: boolean;
  };
}

/* -----------------------------------------------------------------------
   🧾 Audit Log Event Types
------------------------------------------------------------------------*/
export type SuperAdminAction =
  | "CREATE_SUPERADMIN"
  | "ADMIN_APPROVAL"
  | "ADMIN_DEMOTION"
  | "SYSTEM_CONFIG_UPDATE"
  | "BACKUP_RUN"
  | "RESTORE_RUN"
  | "SECRET_ROTATION"
  | "AI_HEALTH_CHECK"
  | "OVERRIDE_ACTION"
  | "SYSTEM_ALERT";

export interface AuditEventPayload {
  actorId: string;
  actorRole: "super_admin";
  ip?: string;
  action: SuperAdminAction;
  entity?: string;
  details?: Record<string, any>;
}

/* -----------------------------------------------------------------------
   ⚙️ System Config Types
------------------------------------------------------------------------*/
export type ConfigKey =
  | "maintenance_mode"
  | "ai_module_enabled"
  | "max_login_attempts"
  | "session_timeout_minutes"
  | "backup_auto_frequency"
  | "system_banner_message";

export interface SystemConfigRecord {
  id?: string;
  key: ConfigKey | string;
  value: string | number | boolean | Record<string, any>;
  updatedBy: string;
  updatedAt?: Date;
}

/* -----------------------------------------------------------------------
   🔐 Secret Rotation Types
------------------------------------------------------------------------*/
export type SecretType = "jwt" | "refresh" | "hmac" | "encryption";

export interface SecretRotationRecord {
  id?: string;
  type: SecretType;
  value: string;
  rotatedBy: string;
  rotatedAt?: Date;
}

/* -----------------------------------------------------------------------
   👑 Admin Management Types
------------------------------------------------------------------------*/
export interface AdminApprovalRequest {
  adminId: string;
  approvedBy: string;
}

export interface AdminDemotionRequest {
  adminId: string;
  demotedBy: string;
  reason?: string;
}

/* -----------------------------------------------------------------------
   📦 Backup & Restore Payloads
------------------------------------------------------------------------*/
export interface BackupRestorePayload {
  s3Key: string;
  confirm: boolean;
}

/* -----------------------------------------------------------------------
   📊 System Overview Snapshot
------------------------------------------------------------------------*/
export interface SystemOverview {
  totalUsers: number;
  athletes: number;
  institutions: number;
  sessions: number;
  activeAlerts: number;
  uptimeMinutes: number;
  environment: string;
}

/* -----------------------------------------------------------------------
   🧠 AI Health Check Result
------------------------------------------------------------------------*/
export interface AIHealthStatus {
  provider: string;
  latencyMs: number;
  sampleResponse: string;
}