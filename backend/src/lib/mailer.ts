import nodemailer from "nodemailer";
import { createTransport } from "nodemailer";
import handlebars from "handlebars";
import path from "path";
import fs from "fs";
import { config } from "../config";
import logger from "../logger";
import { Queue } from "bullmq";
import { registerWorker } from "../workers"; // optional, if using workers
import { ErrorCodes, ApiError } from "../utils/errors";

// Optional fallback for resilience
import sgMail from "@sendgrid/mail";
import AWS from "aws-sdk";

type MailProvider = "smtp" | "sendgrid" | "ses";

export interface MailPayload {
  to: string;
  subject: string;
  template?: string;
  html?: string;
  text?: string;
  context?: Record<string, any>;
  from?: string;
  cc?: string[];
  bcc?: string[];
}

export interface MailerOptions {
  defaultFrom?: string;
  provider?: MailProvider;
  retry?: boolean;
}

/**
 * Enterprise-grade Mailer Class
 * Supports:
 * - SMTP (primary)
 * - SendGrid (secondary)
 * - AWS SES (tertiary)
 * - Templating with Handlebars
 * - Queue integration via BullMQ (optional)
 * - Graceful retries and error logging
 */
class Mailer {
  private transporter: nodemailer.Transporter | null = null;
  private sendGridReady = false;
  private sesReady = false;
  private defaultFrom: string;
  private provider: MailProvider;
  private mailQueue: Queue | null = null;

  constructor(options?: MailerOptions) {
    this.defaultFrom =
      options?.defaultFrom || config.smtpFrom || "no-reply@pa360.net";
    this.provider = options?.provider || "smtp";

    this.initializeProviders();
    this.initializeQueue();
  }

  /**
   * Initialize SMTP / SendGrid / SES providers
   */
  private initializeProviders() {
    try {
      // SMTP (Primary)
      if (this.provider === "smtp") {
        this.transporter = createTransport({
          host: config.smtpHost || "smtp.gmail.com",
          port: config.smtpPort ? Number(config.smtpPort) : 587,
          secure: false,
          auth: {
            user: config.smtpUser,
            pass: config.smtpPass,
          },
        });
        logger.info("📧 Mailer: SMTP initialized successfully");
      }

      // SendGrid (Secondary)
      if (config.sendgridApiKey) {
        sgMail.setApiKey(config.sendgridApiKey);
        this.sendGridReady = true;
        logger.info("📧 Mailer: SendGrid fallback ready");
      }

      // AWS SES (Tertiary)
      if (config.awsAccessKeyId && config.awsSecretAccessKey && config.awsRegion) {
        AWS.config.update({
          accessKeyId: config.awsAccessKeyId,
          secretAccessKey: config.awsSecretAccessKey,
          region: config.awsRegion,
        });
        this.sesReady = true;
        logger.info("📧 Mailer: AWS SES fallback ready");
      }
    } catch (err: any) {
      logger.error(`Mailer initialization failed: ${err.message}`);
    }
  }

  /**
   * Initialize mail queue (optional, for async sending)
   */
  private initializeQueue() {
    try {
      this.mailQueue = new Queue("mailQueue", {
        connection: { host: "127.0.0.1", port: 6379 },
      });
      logger.info("📬 Mail Queue initialized");
    } catch (err: any) {
      logger.warn("⚠️ Mail Queue not connected. Running direct mode.");
    }
  }

  /**
   * Load and compile Handlebars template
   */
  private compileTemplate(templateName: string, context: Record<string, any>): string {
    try {
      const filePath = path.join(
        __dirname,
        "../../templates/email",
        `${templateName}.hbs`
      );
      const source = fs.readFileSync(filePath, "utf8");
      const compiled = handlebars.compile(source);
      return compiled(context);
    } catch (err: any) {
      logger.error(`Failed to load email template: ${templateName} (${err.message})`);
      throw new ApiError(500, "Template rendering failed", ErrorCodes.SERVER_ERROR);
    }
  }

  /**
   * Main sendMail method (auto-fallback between providers)
   */
  public async sendMail(payload: MailPayload): Promise<void> {
    const { to, subject, template, html, text, context, cc, bcc } = payload;
    const from = payload.from || this.defaultFrom;

    // Prepare final HTML
    const htmlBody = template ? this.compileTemplate(template, context || {}) : html;

    try {
      if (this.transporter) {
        await this.transporter.sendMail({ from, to, cc, bcc, subject, html: htmlBody, text });
        logger.info(`✅ Email sent via SMTP → ${to}`);
        return;
      }

      // Fallback: SendGrid
      if (this.sendGridReady) {
        await sgMail.send({ to, from, subject, html: htmlBody, text });
        logger.info(`✅ Email sent via SendGrid → ${to}`);
        return;
      }

      // Fallback: AWS SES
      if (this.sesReady) {
        const ses = new AWS.SES();
        await ses
          .sendEmail({
            Source: from,
            Destination: { ToAddresses: [to], CcAddresses: cc, BccAddresses: bcc },
            Message: {
              Subject: { Data: subject },
              Body: { Html: { Data: htmlBody }, Text: { Data: text || "" } },
            },
          })
          .promise();
        logger.info(`✅ Email sent via AWS SES → ${to}`);
        return;
      }

      throw new Error("No email provider available");
    } catch (err: any) {
      logger.error(`❌ Email sending failed: ${err.message}`);

      // Re-queue for retry (if queue exists)
      if (this.mailQueue) {
        await this.mailQueue.add("resendMail", payload, {
          delay: 30_000, // retry after 30 seconds
          attempts: 3,
        });
        logger.warn(`📬 Email job requeued for ${to}`);
      }

      throw new ApiError(500, "Email delivery failed", ErrorCodes.SERVER_ERROR, {
        recipient: to,
      });
    }
  }

  /**
   * Enqueue email (async mode)
   */
  public async enqueueMail(payload: MailPayload) {
    if (!this.mailQueue) {
      logger.warn("Mail queue unavailable, sending directly.");
      return this.sendMail(payload);
    }

    await this.mailQueue.add("sendMail", payload, {
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
    });

    logger.info(`📬 Mail job queued → ${payload.to}`);
  }
}

// Singleton instance
export const mailer = new Mailer();

// Export direct helper for simplicity
export const sendMail = (payload: MailPayload) => mailer.sendMail(payload);

export default mailer;