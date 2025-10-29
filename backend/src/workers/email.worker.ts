/**
 * workers/email.worker.ts
 * -------------------------------------------------------------
 * Email Worker (Enterprise-Grade)
 *
 * Handles queued email jobs:
 *  - Invitation emails
 *  - Password resets / verification
 *  - Admin notifications
 *
 * Features:
 *  - Job retries & backoff on failure
 *  - Template rendering system
 *  - Graceful logging and alerting
 *  - Works with both local SMTP & production mail providers
 */

import { Job } from "bullmq";
import nodemailer from "nodemailer";
import { config } from "../config";
import { logger } from "../logger";
import path from "path";
import fs from "fs";
import handlebars from "handlebars";

/**
 * Configure reusable email transport
 * - Supports: Gmail, SMTP, or AWS SES (depending on env vars)
 */
const transporter = nodemailer.createTransport({
  host: config.smtpHost || "smtp.gmail.com",
  port: config.smtpPort ? Number(config.smtpPort) : 587,
  secure: false, // true for 465, false for others
  auth: {
    user: config.smtpUser,
    pass: config.smtpPass,
  },
});

/**
 * Load email templates safely (from /templates/email)
 */
const loadTemplate = (templateName: string, context: Record<string, any>) => {
  try {
    const templatePath = path.join(__dirname, "../../templates/email", `${templateName}.hbs`);
    const source = fs.readFileSync(templatePath, "utf-8");
    const compiled = handlebars.compile(source);
    return compiled(context);
  } catch (err) {
    logger.error(`[EMAIL WORKER] Template load error: ${templateName}`, err);
    throw new Error("Template rendering failed");
  }
};

/**
 * Send email with fail-safety & logs
 */
const sendEmail = async (to: string, subject: string, html: string) => {
  try {
    await transporter.sendMail({
      from: config.smtpFrom || `"Project Athlete 360" <no-reply@pa360.net>`,
      to,
      subject,
      html,
    });
    logger.info(`[EMAIL WORKER] ✉️ Sent email to ${to}`);
  } catch (err: any) {
    logger.error(`[EMAIL WORKER] ❌ Failed to send email to ${to}: ${err.message}`);
    throw err;
  }
};

/**
 * Processor function — called automatically when jobs are added
 */
export default async function (job: Job) {
  logger.info(`[EMAIL WORKER] Processing job ${job.id}: ${job.name}`);

  const { type, payload } = job.data;

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

      default:
        logger.warn(`[EMAIL WORKER] Unknown job type: ${type}`);
        break;
    }

    logger.info(`[EMAIL WORKER] ✅ Job ${job.id} (${type}) completed`);
  } catch (err: any) {
    logger.error(`[EMAIL WORKER] ❌ Job ${job.id} failed: ${err.message}`);
    throw err;
  }
}

/**
 * Handles Invitation Email
 */
async function handleInvitationEmail(payload: { to: string; inviter: string; link: string }) {
  const html = loadTemplate("invitation", {
    inviter: payload.inviter,
    link: payload.link,
  });
  await sendEmail(payload.to, "You're Invited to Join Project Athlete 360", html);
}

/**
 * Handles Password Reset Email
 */
async function handlePasswordResetEmail(payload: { to: string; resetLink: string }) {
  const html = loadTemplate("passwordReset", {
    resetLink: payload.resetLink,
  });
  await sendEmail(payload.to, "Reset Your Password", html);
}

/**
 * Handles Session Reminder Email
 */
async function handleSessionReminderEmail(payload: { to: string; athleteName: string; sessionDate: string }) {
  const html = loadTemplate("sessionReminder", {
    athleteName: payload.athleteName,
    sessionDate: payload.sessionDate,
  });
  await sendEmail(payload.to, "Upcoming Training Session Reminder", html);
}