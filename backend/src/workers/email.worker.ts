/**
 * src/workers/email.worker.ts
 * ------------------------------------------------------------------
 * Enterprise-grade Email Worker
 * - Dual SMTP transport with failover
 * - Handlebars templating (.hbs)
 * - Automatic system alerts on delivery failure
 * - Secure logging (no PII)
 * - Template caching for performance
 * ------------------------------------------------------------------
 */

import { Job } from "bullmq";
import nodemailer, { Transporter } from "nodemailer";
import fs from "fs";
import path from "path";
import handlebars from "handlebars";
import { config } from "../config";
import { logger } from "../logger";
import { Errors } from "../utils/errors";
import { addNotificationJob } from "../workers/notification.worker";

// ------------------------------------------------------------------
// 🧠 Helpers
// ------------------------------------------------------------------
const maskEmail = (email: string) => {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
};

// In-memory cache for templates
const templateCache: Record<string, HandlebarsTemplateDelegate> = {};

// ------------------------------------------------------------------
// 📬 Primary & Backup Transporter
// ------------------------------------------------------------------
const primaryTransporter: Transporter = nodemailer.createTransport({
  host: config.email.smtpHost,
  port: Number(config.email.smtpPort || 587),
  secure: config.email.smtpSecure,
  auth: {
    user: config.email.smtpUser,
    pass: config.email.smtpPass,
  },
});

const backupTransporter: Transporter | null =
  config.email.backupSmtpHost && config.email.backupSmtpUser
    ? nodemailer.createTransport({
        host: config.email.backupSmtpHost,
        port: Number(config.email.backupSmtpPort || 587),
        secure: false,
        auth: {
          user: config.email.backupSmtpUser,
          pass: config.email.backupSmtpPass,
        },
      })
    : null;

// ------------------------------------------------------------------
// 🧩 Template Loader (cached)
// ------------------------------------------------------------------
const loadTemplate = (templateName: string, context: Record<string, any>) => {
  try {
    if (!templateCache[templateName]) {
      const templatePath = path.join(__dirname, "../../templates/email", `${templateName}.hbs`);
      if (!fs.existsSync(templatePath)) {
        throw new Error(`Email template not found: ${templateName}`);
      }
      const source = fs.readFileSync(templatePath, "utf-8");
      templateCache[templateName] = handlebars.compile(source);
    }
    return templateCache[templateName](context);
  } catch (err: any) {
    logger.error(`[EMAIL WORKER] ❌ Template load failed for ${templateName}`, {
      error: err.message,
    });
    throw Errors.ServiceUnavailable("Email template rendering failed");
  }
};

// ------------------------------------------------------------------
// ✉️ Email Sender (Failover + Alert Escalation)
// ------------------------------------------------------------------
const sendEmail = async (to: string, subject: string, html: string, attempt = 1) => {
  const masked = maskEmail(to);
  try {
    await primaryTransporter.sendMail({
      from: `${config.email.fromName} <${config.email.fromEmail}>`,
      to,
      subject,
      html,
    });
    logger.info(`[EMAIL] ✅ Sent to ${masked} (attempt=${attempt})`);
  } catch (err: any) {
    logger.warn(`[EMAIL] ⚠️ Primary failed for ${masked}: ${err.message}`);
    if (backupTransporter) {
      try {
        await backupTransporter.sendMail({
          from: `${config.email.fromName} <${config.email.fromEmail}>`,
          to,
          subject,
          html,
        });
        logger.info(`[EMAIL] ✅ Sent via backup to ${masked}`);
      } catch (backupErr: any) {
        logger.error(`[EMAIL] ❌ Backup failed for ${masked}: ${backupErr.message}`);

        // Notify system admin of failure escalation
        await addNotificationJob({
          type: "criticalAlert",
          title: "Email Worker Failure",
          message: `Email delivery failed to ${masked} after both transport retries.`,
          severity: "high",
        }).catch(() => logger.error("Failed to enqueue admin alert"));

        throw Errors.ServiceUnavailable("Email transport failure");
      }
    } else {
      throw Errors.ServiceUnavailable("Email service unavailable");
    }
  }
};

// ------------------------------------------------------------------
// ⚙️ Worker Job Processor Entry
// ------------------------------------------------------------------
export default async function (job: Job) {
  const { type, payload } = job.data;
  logger.info(`[EMAIL WORKER] 🚀 Processing job ${job.name} (${type})`);

  try {
    switch (type) {
      case "invitation":
        await handleInvitationEmail(payload);
        break;
      case "passwordReset":
        await handlePasswordResetEmail(payload);
        break;
      case "sessionReminder":
        await handleSessionReminderEmail(payload);
        break;
      case "systemAlert":
        await handleSystemAlertEmail(payload);
        break;
      case "quotaWarning":
        await handleQuotaWarningEmail(payload);
        break;
      case "trialExpiry":
        await handleTrialExpiryEmail(payload);
        break;
      default:
        logger.warn(`[EMAIL WORKER] Unknown email type: ${type}`);
    }

    logger.info(`[EMAIL WORKER] ✅ Job ${job.id} (${type}) completed`);
  } catch (err: any) {
    logger.error(`[EMAIL WORKER] ❌ Job ${job.id} failed: ${err.message}`);
    throw err;
  }
}

// ------------------------------------------------------------------
// 📩 Template Handlers
// ------------------------------------------------------------------
async function handleInvitationEmail(payload: { to: string; inviter: string; link: string }) {
  const html = loadTemplate("invitation", payload);
  await sendEmail(payload.to, "You're Invited to Join Project Athlete 360", html);
}

async function handlePasswordResetEmail(payload: { to: string; resetLink: string }) {
  const html = loadTemplate("password_reset", payload);
  await sendEmail(payload.to, "Reset Your Password - Project Athlete 360", html);
}

async function handleSessionReminderEmail(payload: {
  to: string;
  athleteName: string;
  sessionDate: string;
}) {
  const html = loadTemplate("session_reminder", payload);
  await sendEmail(payload.to, "Training Session Reminder - Project Athlete 360", html);
}

async function handleSystemAlertEmail(payload: { to?: string; title: string; message: string }) {
  const html = loadTemplate("system_alert", payload);
  const target = payload.to || config.email.alertRecipient || "alerts@pa360.net";
  await sendEmail(target, `[ALERT] ${payload.title}`, html);
}

async function handleQuotaWarningEmail(payload: { to: string; usage: number; limit: number }) {
  const html = loadTemplate("quota_warning_generic", payload);
  await sendEmail(payload.to, "Storage Quota Warning - Project Athlete 360", html);
}

async function handleTrialExpiryEmail(payload: { to: string; daysLeft: number }) {
  const templateName =
    payload.daysLeft <= 1
      ? "trial_expiry_warning_1day"
      : payload.daysLeft <= 7
      ? "trial_expiry_warning_7days"
      : "trial_expired";
  const html = loadTemplate(templateName, payload);
  await sendEmail(payload.to, "Your Trial is Ending Soon - Project Athlete 360", html);
}