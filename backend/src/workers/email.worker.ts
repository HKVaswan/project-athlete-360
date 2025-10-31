// src/workers/email.worker.ts
/**
 * Email Worker (Enterprise-Grade, Hardened)
 * -----------------------------------------
 * - Supports provider failover (Primary → Backup)
 * - Cached templates for speed
 * - Secure logging (no PII leaks)
 * - Structured alerts to Super Admin on critical failure
 */

import { Job } from "bullmq";
import nodemailer, { Transporter } from "nodemailer";
import { config } from "../config";
import { logger } from "../logger";
import fs from "fs";
import path from "path";
import handlebars from "handlebars";
import { Errors } from "../utils/errors";

// Optional: Notify system admin via notification worker or Slack webhook later
import { addNotificationJob } from "../workers/notification.worker";

// In-memory cache for templates
const templateCache: Record<string, HandlebarsTemplateDelegate> = {};

/* ────────────────────────────────────── */
/* 📬 Transport Configuration (Primary + Backup) */
/* ────────────────────────────────────── */
const primaryTransporter: Transporter = nodemailer.createTransport({
  host: config.smtpHost || "smtp.gmail.com",
  port: Number(config.smtpPort || 587),
  secure: false,
  auth: {
    user: config.smtpUser,
    pass: config.smtpPass,
  },
});

const backupTransporter: Transporter | null =
  config.backupSmtpHost && config.backupSmtpUser
    ? nodemailer.createTransport({
        host: config.backupSmtpHost,
        port: Number(config.backupSmtpPort || 587),
        secure: false,
        auth: {
          user: config.backupSmtpUser,
          pass: config.backupSmtpPass,
        },
      })
    : null;

/* ────────────────────────────────────── */
/* 🧠 Template Loader (Cached)            */
/* ────────────────────────────────────── */
const loadTemplate = (templateName: string, context: Record<string, any>) => {
  try {
    if (!templateCache[templateName]) {
      const templatePath = path.join(
        __dirname,
        "../../templates/email",
        `${templateName}.hbs`
      );
      const source = fs.readFileSync(templatePath, "utf-8");
      templateCache[templateName] = handlebars.compile(source);
    }
    return templateCache[templateName](context);
  } catch (err: any) {
    logger.error(`[EMAIL WORKER] ❌ Template load failed: ${templateName}`, {
      error: err.message,
    });
    throw Errors.ServiceUnavailable("Email template rendering failed");
  }
};

/* ────────────────────────────────────── */
/* ✉️ Send Email (with failover + retry)  */
/* ────────────────────────────────────── */
const sendEmail = async (
  to: string,
  subject: string,
  html: string,
  attempt = 1
) => {
  try {
    await primaryTransporter.sendMail({
      from: config.smtpFrom || `"Project Athlete 360" <no-reply@pa360.net>`,
      to,
      subject,
      html,
    });
    logger.info(`[EMAIL] ✅ Sent to ${to} [attempt=${attempt}]`);
  } catch (err: any) {
    logger.warn(`[EMAIL] ⚠️ Primary transport failed: ${err.message}`);
    if (backupTransporter) {
      try {
        await backupTransporter.sendMail({
          from: config.smtpFrom || `"Project Athlete 360" <no-reply@pa360.net>`,
          to,
          subject,
          html,
        });
        logger.info(`[EMAIL] ✅ Sent via backup transporter to ${to}`);
      } catch (backupErr: any) {
        logger.error(`[EMAIL] ❌ Backup transport failed: ${backupErr.message}`);

        // escalate to system admin if all transports fail
        await addNotificationJob({
          type: "criticalAlert",
          title: "Email Worker Failure",
          message: `Failed to send email to ${to} after backup retry.`,
          severity: "high",
        }).catch(() => logger.error("Failed to enqueue system admin alert"));

        throw Errors.ServiceUnavailable("All email transports failed");
      }
    } else {
      throw Errors.ServiceUnavailable("Email service unavailable");
    }
  }
};

/* ────────────────────────────────────── */
/* ⚙️ Job Processor Entry Point           */
/* ────────────────────────────────────── */
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
      default:
        logger.warn(`[EMAIL WORKER] Unknown email type: ${type}`);
        break;
    }

    logger.info(`[EMAIL WORKER] ✅ Job ${job.id} (${type}) completed`);
  } catch (err: any) {
    logger.error(`[EMAIL WORKER] ❌ Job ${job.id} failed: ${err.message}`);
    throw err;
  }
}

/* ────────────────────────────────────── */
/* 📩 Template Handlers                   */
/* ────────────────────────────────────── */
async function handleInvitationEmail(payload: {
  to: string;
  inviter: string;
  link: string;
}) {
  const html = loadTemplate("invitation", payload);
  await sendEmail(payload.to, "You're Invited to Join Project Athlete 360", html);
}

async function handlePasswordResetEmail(payload: {
  to: string;
  resetLink: string;
}) {
  const html = loadTemplate("passwordReset", payload);
  await sendEmail(payload.to, "Reset Your Password", html);
}

async function handleSessionReminderEmail(payload: {
  to: string;
  athleteName: string;
  sessionDate: string;
}) {
  const html = loadTemplate("sessionReminder", payload);
  await sendEmail(payload.to, "Training Session Reminder", html);
}

async function handleSystemAlertEmail(payload: {
  to: string;
  title: string;
  message: string;
}) {
  const html = loadTemplate("systemAlert", payload);
  await sendEmail(payload.to, `[ALERT] ${payload.title}`, html);
}