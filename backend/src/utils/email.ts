/**
 * src/utils/email.ts
 * -------------------------------------------------------
 * Centralized enterprise email utility.
 * Supports Handlebars (.hbs) templates, queuing, attachments,
 * and multi-provider delivery (SMTP, SES, or fallback queue).
 */

import nodemailer, { Transporter } from "nodemailer";
import path from "path";
import fs from "fs";
import Handlebars from "handlebars";
import { config } from "../config";
import { logger } from "../logger";
import { addNotificationJob } from "../workers/notification.worker";
import { ApiError } from "../utils/errors";

let transporter: Transporter | null = null;

// ----------------------------------------------------------------------------
// 🧭 Transport Initialization
// ----------------------------------------------------------------------------
const initializeTransporter = (): Transporter => {
  if (transporter) return transporter;

  if (config.email.provider === "smtp") {
    transporter = nodemailer.createTransport({
      host: config.email.smtpHost,
      port: config.email.smtpPort,
      secure: config.email.smtpSecure,
      auth: { user: config.email.smtpUser, pass: config.email.smtpPass },
    });
  } else if (config.email.provider === "ses") {
    const AWS = require("aws-sdk");
    AWS.config.update({
      region: config.email.sesRegion,
      accessKeyId: config.email.sesKey,
      secretAccessKey: config.email.sesSecret,
    });
    const ses = new AWS.SES({ apiVersion: "2010-12-01" });
    transporter = nodemailer.createTransport({ SES: { ses, aws: AWS } });
  } else {
    throw new Error("Invalid email provider configuration.");
  }

  logger.info(`[EMAIL] Transporter initialized with provider: ${config.email.provider}`);
  return transporter;
};

// ----------------------------------------------------------------------------
// 🧩 Template Loader & Renderer
// ----------------------------------------------------------------------------
const templateCache: Record<string, Handlebars.TemplateDelegate> = {};

const loadTemplate = (templateName: string): Handlebars.TemplateDelegate => {
  if (templateCache[templateName]) return templateCache[templateName];

  const filePath = path.join(__dirname, "../../templates/email", `${templateName}.hbs`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Template not found: ${templateName}`);
  }

  const source = fs.readFileSync(filePath, "utf8");
  const compiled = Handlebars.compile(source);
  templateCache[templateName] = compiled;
  return compiled;
};

// ----------------------------------------------------------------------------
// 📤 Send Email
// ----------------------------------------------------------------------------
export interface EmailOptions {
  to: string;
  subject: string;
  template?: string;
  variables?: Record<string, string | number>;
  html?: string;
  text?: string;
  attachments?: { filename: string; path: string }[];
  useQueue?: boolean; // send asynchronously via worker
}

export const sendEmail = async (options: EmailOptions): Promise<void> => {
  try {
    const {
      to,
      subject,
      template,
      variables = {},
      html,
      text,
      attachments,
      useQueue = false,
    } = options;

    // 📨 If useQueue = true → delegate to notification worker
    if (useQueue) {
      await addNotificationJob({
        type: "custom",
        recipientId: to,
        title: subject,
        body: text || "You’ve received a new message from Project Athlete 360.",
        channel: ["email"],
        meta: { template, templateContext: variables },
      });
      return;
    }

    const mailTransporter = initializeTransporter();

    let htmlContent = html;
    if (template) {
      const render = loadTemplate(template);
      htmlContent = render(variables);
    }

    await mailTransporter.sendMail({
      from: `${config.email.fromName} <${config.email.fromEmail}>`,
      to,
      subject,
      text: text || "Please view this email in HTML format.",
      html: htmlContent,
      attachments,
    });

    logger.info(`[EMAIL] ✅ Sent successfully to ${to} (${template || "custom"})`);
  } catch (error: any) {
    logger.error(`[EMAIL ERROR] ❌ Failed to send to ${options.to}: ${error.message}`);
    throw new ApiError(500, `Failed to send email: ${error.message}`);
  }
};

// ----------------------------------------------------------------------------
// 📬 Common Email Templates (Reusable Shortcuts)
// ----------------------------------------------------------------------------

export const sendVerificationEmail = async (
  to: string,
  username: string,
  verificationLink: string
) =>
  sendEmail({
    to,
    subject: "Verify Your Account - Project Athlete 360",
    template: "verify_account",
    variables: { username, verificationLink },
  });

export const sendPasswordResetEmail = async (to: string, resetLink: string) =>
  sendEmail({
    to,
    subject: "Password Reset Request - Project Athlete 360",
    template: "password_reset",
    variables: { resetLink },
  });

export const sendInvitationEmail = async (
  to: string,
  inviter: string,
  invitationLink: string
) =>
  sendEmail({
    to,
    subject: "You’re Invited to Join - Project Athlete 360",
    template: "invitation",
    variables: { inviter, invitationLink },
  });