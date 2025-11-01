/**
 * src/middleware/paymentWebhookVerifier.middleware.ts
 * --------------------------------------------------------------------------
 * 🛡️ Enterprise-Grade Webhook Verifier Middleware
 *
 * Purpose:
 *  - Verifies authenticity of incoming payment webhooks (Stripe / Razorpay).
 *  - Protects against replay attacks, payload tampering, and signature forgery.
 *  - Ensures only legitimate gateway callbacks reach billing/subscription logic.
 *
 * Supported providers: Stripe, Razorpay, (easily extendable for PayPal, etc.)
 *
 * Integration:
 *   app.post('/webhook/stripe', verifyPaymentWebhook('stripe'), stripeHandler);
 *   app.post('/webhook/razorpay', verifyPaymentWebhook('razorpay'), razorpayHandler);
 * --------------------------------------------------------------------------
 */

import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { logger } from "../logger";
import { Errors } from "../utils/errors";

/* --------------------------------------------------------------------------
   🔐 Provider Webhook Secrets (env-based for security)
--------------------------------------------------------------------------- */
const STRIPE_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const RAZORPAY_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "";

/* --------------------------------------------------------------------------
   🧠 Helper: Compare signatures securely (constant-time)
--------------------------------------------------------------------------- */
function safeCompare(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/* --------------------------------------------------------------------------
   🧩 Middleware Factory
--------------------------------------------------------------------------- */
export const verifyPaymentWebhook =
  (provider: "stripe" | "razorpay") =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawBody = (req as any).rawBody || JSON.stringify(req.body);
      if (!rawBody) throw Errors.Validation("Missing raw request body for signature verification.");

      let signatureHeader: string | undefined;
      let secret: string;

      if (provider === "stripe") {
        signatureHeader = req.headers["stripe-signature"] as string;
        secret = STRIPE_SECRET;
        if (!secret) throw Errors.Server("Stripe webhook secret missing from environment.");

        const isValid = verifyStripeSignature(rawBody, signatureHeader, secret);
        if (!isValid) throw Errors.Unauthorized("Invalid Stripe webhook signature.");
      } else if (provider === "razorpay") {
        signatureHeader = req.headers["x-razorpay-signature"] as string;
        secret = RAZORPAY_SECRET;
        if (!secret) throw Errors.Server("Razorpay webhook secret missing from environment.");

        const body = typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody);
        const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
        if (!signatureHeader || !safeCompare(expected, signatureHeader)) {
          throw Errors.Unauthorized("Invalid Razorpay webhook signature.");
        }
      } else {
        throw Errors.Validation(`Unsupported webhook provider: ${provider}`);
      }

      // Optional anti-replay layer (basic)
      const eventId = extractEventId(req, provider);
      if (await isReplayAttack(eventId)) {
        throw Errors.Unauthorized("Replay attack detected on payment webhook.");
      }

      logger.info(`[WebhookVerifier] ✅ Verified ${provider} webhook successfully.`);
      next();
    } catch (err: any) {
      logger.error(`[WebhookVerifier] ❌ Verification failed: ${err.message}`);
      res.status(400).json({
        success: false,
        message: "Invalid or unauthorized webhook signature.",
      });
    }
  };

/* --------------------------------------------------------------------------
   🧠 Stripe Verification Helper
--------------------------------------------------------------------------- */
function verifyStripeSignature(payload: string, signatureHeader: string, secret: string): boolean {
  try {
    if (!signatureHeader) return false;

    const [tPart, v1Part] = signatureHeader.split(",");
    const timestamp = tPart.split("=")[1];
    const receivedSig = v1Part.split("=")[1];

    const expectedSig = crypto
      .createHmac("sha256", secret)
      .update(`${timestamp}.${payload}`)
      .digest("hex");

    // 5-minute replay prevention window
    const tolerance = 300;
    const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
    if (age > tolerance) return false;

    return safeCompare(expectedSig, receivedSig);
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------------------
   🔄 Replay Attack Detection
   (prevents malicious re-use of legitimate webhook events)
--------------------------------------------------------------------------- */
const recentEventCache = new Map<string, number>();
const EVENT_TTL = 5 * 60 * 1000; // 5 minutes

async function isReplayAttack(eventId: string): Promise<boolean> {
  if (!eventId) return false;
  const now = Date.now();
  if (recentEventCache.has(eventId)) return true;
  recentEventCache.set(eventId, now);

  // Clean old events
  for (const [id, ts] of recentEventCache.entries()) {
    if (now - ts > EVENT_TTL) recentEventCache.delete(id);
  }
  return false;
}

/* --------------------------------------------------------------------------
   🆔 Extract Webhook Event ID for Anti-Replay
--------------------------------------------------------------------------- */
function extractEventId(req: Request, provider: "stripe" | "razorpay"): string {
  try {
    const body = req.body || {};
    if (provider === "stripe") return body.id || body.data?.object?.id || "";
    if (provider === "razorpay") return body?.payload?.payment?.entity?.id || "";
    return "";
  } catch {
    return "";
  }
}