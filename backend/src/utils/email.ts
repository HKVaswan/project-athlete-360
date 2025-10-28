/**
 * src/utils/email.ts
 * -------------------------------------------------------
 * Centralized enterprise email utility.
 * Supports HTML templating, attachments, and dynamic providers.
 */

import nodemailer, { Transporter } from "nodemailer";
import path from "path";
import fs from "fs";
import config from "../config";
import { logger } from "../logger";

let transporter: Transporter;

// ----------------------------------------------------------------------------
// 🧭 Transport Initialization
// ----------------------------------------------------------------------------

/**
 * Initializes transporter based on environment.
 * Supports SMTP (default) or AWS SES.
 */
const initializeTransporter = (): Transporter => {
  if (transporter) return transporter;

  if (config.email.provider === "smtp") {
    transporter = nodemailer.createTransport({
      host: config.email.smtpHost,
      port: config.email.smtpPort,
      secure: config.email.smtpSecure, // true for 465, false for other ports
      auth: {
        user: config.email.smtpUser,
        pass: config.email.smtpPass,
      },
    });
  } else if (config.email.provider === "ses") {
    const AWS = require("aws-sdk");
    AWS.config.update({
      region: config.email.sesRegion,
      accessKeyId: config.email.sesKey,
      secretAccessKey: config.email.sesSecret,
    });
    const ses = new AWS.SES({ apiVersion: "2010-12-01" });
    transporter = nodemailer.createTransport({
      SES: { ses, aws: AWS },
    });
  } else {
    throw new Error("Invalid email provider configuration.");
  }

  logger.info(`[EMAIL] Transporter initialized with provider: ${config.email.provider}`);
  return transporter;
};

// ----------------------------------------------------------------------------
// 📤 Send Email
// ----------------------------------------------------------------------------

export interface EmailOptions {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  templateName?: string;
  variables?: Record<string, string>;
  attachments?: { filename: string; path: string }[];
}

/**
 * Reads template from `templates/email/` directory.
 */
const loadTemplate = (templateName: string, variables?: Record<string, string>): string => {
  const filePath = path.join(__dirname, "../../templates/email", `${templateName}.html`);
  let html = fs.readFileSync(filePath, "utf8");

  if (variables) {
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, "g");
      html = html.replace(regex, value);
    }
  }
  return html;
};

/**
 * Send an email using the configured transporter.
 */
export const sendEmail = async (options: EmailOptions): Promise<void> => {
  try {
    const mailTransporter = initializeTransporter();

    const htmlContent =
      options.html ||
      (options.templateName ? loadTemplate(options.templateName, options.variables) : undefined);

    await mailTransporter.sendMail({
      from: `${config.email.fromName} <${config.email.fromEmail}>`,
      to: options.to,
      subject: options.subject,
      text: options.text || "Please view this email in HTML format.",
      html: htmlContent,
      attachments: options.attachments,
    });

    logger.info(`[EMAIL] Sent successfully to ${options.to}`);
  } catch (error: any) {
    logger.error(`[EMAIL ERROR] Failed to send to ${options.to}: ${error.message}`);
    throw error;
  }
};

// ----------------------------------------------------------------------------
// 📬 Common Email Templates (Reusable Functions)
// ----------------------------------------------------------------------------

export const sendVerificationEmail = async (to: string, username: string, verificationLink: string) =>
  sendEmail({
    to,
    subject: "Verify Your Account - Project Athlete 360",
    templateName: "verify-account",
    variables: { username, verificationLink },
  });

export const sendPasswordResetEmail = async (to: string, resetLink: string) =>
  sendEmail({
    to,
    subject: "Password Reset Request - Project Athlete 360",
    templateName: "password-reset",
    variables: { resetLink },
  });

export const sendInvitationEmail = async (to: string, inviter: string, invitationLink: string) =>
  sendEmail({
    to,
    subject: "You're Invited to Join - Project Athlete 360",
    templateName: "invitation",
    variables: { inviter, invitationLink },
  });