/**
 * src/types/superAdmin.d.ts
 * ----------------------------------------------------------------------
 * Global Type Declarations for Super Admin & Audit Ecosystem
 */

import type { Request } from "express";

/* -----------------------------------------------------------------------
   👑 Super Admin Core Types
------------------------------------------------------------------------*/
export interface SuperAdminUser {
  id: string;
  username: string;
  email: string;
  role: "super_admin";
  mfaVerified?: boolean;
  lastLoginAt?: Date;
  permissions?: string[];
}

/**
 * Used in Express middleware & controllers
 */
export interface SuperAdminRequest extends Request {
  user: SuperAdminUser;
}

/* -----------------------------------------------------------------------
   🧾 Audit Record Structure
------------------------------------------------------------------------*/
export interface AuditRecord {
  id?: string;
  actorId: string;
  actorRole: "super_admin" | "admin" | "system";
  ip?: string;
  action: AdminAction;
  entity?: string;
  details?: Record<string, any>;
  createdAt?: Date;
}

/* -----------------------------------------------------------------------
   ⚙️ Enum: Administrative Actions
------------------------------------------------------------------------*/
export type AdminAction =
  | "CREATE_ADMIN"
  | "APPROVE_ADMIN"
  | "DELETE_ADMIN"
  | "SUSPEND_USER"
  | "UPDATE_SYSTEM_CONFIG"
  | "BACKUP_TRIGGER"
  | "RESTORE_TRIGGER"
  | "SECRET_ROTATION"
  | "IMPERSONATE_USER"
  | "TERMINATE_IMPERSONATION"
  | "AI_MODULE_CHECK"
  | "SYSTEM_ALERT";

/* -----------------------------------------------------------------------
   🕵️ Impersonation Session
------------------------------------------------------------------------*/
export interface ImpersonationSession {
  id?: string;
  superAdminId: string;
  targetUserId: string;
  targetRole: string;
  startedAt: Date;
  expiresAt: Date;
  terminatedAt?: Date | null;
  active: boolean;
}

/* -----------------------------------------------------------------------
   🔐 System Config & Secret Management
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
  key: ConfigKey;
  value: string | number | boolean | Record<string, any>;
  updatedBy: string;
  updatedAt?: Date;
}

/* -----------------------------------------------------------------------
   🔑 Secret Rotation Events
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
   🧠 System & AI Health
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

export interface AIHealthStatus {
  provider: string;
  latencyMs: number;
  sampleResponse: string;
}