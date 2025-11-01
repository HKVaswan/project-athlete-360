/**
 * src/services/payment.service.ts
 * --------------------------------------------------------------------
 * Dual Payment Provider (Razorpay + Stripe)
 * --------------------------------------------------------------------
 * Responsibilities:
 *  - Create, verify, and manage subscriptions or one-time payments
 *  - Handle international (Stripe) and Indian (Razorpay) users
 *  - Maintain unified subscription records in database
 *  - Fully auditable with secure webhook verification
 */

import Razorpay from "razorpay";
import Stripe from "stripe";
import crypto from "crypto";
import { config } from "../config";
import prisma from "../prismaClient";
import { logger } from "../logger";
import { Errors } from "../utils/errors";
import { recordAuditEvent } from "./audit.service";
import { sendEmail } from "../utils/email";

/* -----------------------------------------------------------------------
   🔑 Initialize Providers
------------------------------------------------------------------------*/
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2024-04-10" });

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

/* -----------------------------------------------------------------------
   🌍 Helper: Select Provider based on Region/Currency
------------------------------------------------------------------------*/
export const autoDetectProvider = (country: string, currency = "INR") => {
  if (country.toLowerCase() === "india" || currency.toUpperCase() === "INR") return "razorpay";
  return "stripe";
};

/* -----------------------------------------------------------------------
   💳 Create Checkout Session (Dynamic Provider)
------------------------------------------------------------------------*/
export const createCheckoutSession = async (userId: string, planId: string, country = "IN") => {
  try {
    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw Errors.NotFound("Plan not found");

    const provider = autoDetectProvider(country, plan.currency);

    if (provider === "razorpay") {
      const order = await razorpay.orders.create({
        amount: Math.round(plan.price * 100),
        currency: plan.currency || "INR",
        receipt: `order_${userId}_${Date.now()}`,
        notes: { planId, userId },
      });

      await prisma.paymentSession.create({
        data: {
          userId,
          planId,
          provider,
          providerOrderId: order.id,
          amount: plan.price,
          currency: plan.currency,
          status: "created",
        },
      });

      return { provider, checkoutUrl: null, orderId: order.id, key: process.env.RAZORPAY_KEY_ID };
    }

    // Stripe flow (global)
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      line_items: [
        {
          price_data: {
            currency: plan.currency || "usd",
            unit_amount: Math.round(plan.price * 100),
            product_data: { name: plan.name, description: plan.description },
          },
          quantity: 1,
        },
      ],
      success_url: `${config.baseUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.baseUrl}/payment/cancel`,
      metadata: { planId, userId },
    });

    await prisma.paymentSession.create({
      data: {
        userId,
        planId,
        provider,
        providerOrderId: session.id,
        amount: plan.price,
        currency: plan.currency,
        status: "created",
      },
    });

    return { provider, checkoutUrl: session.url };
  } catch (err: any) {
    logger.error("[PAYMENT] Failed to create checkout session", err);
    throw Errors.Server("Payment session creation failed");
  }
};

/* -----------------------------------------------------------------------
   ✅ Verify Razorpay Payment
------------------------------------------------------------------------*/
export const verifyRazorpayPayment = async (orderId: string, paymentId: string, signature: string) => {
  try {
    const body = `${orderId}|${paymentId}`;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
      .update(body.toString())
      .digest("hex");

    if (expectedSignature !== signature) {
      throw Errors.Forbidden("Invalid Razorpay signature");
    }

    const session = await prisma.paymentSession.findUnique({ where: { providerOrderId: orderId } });
    if (!session) throw Errors.NotFound("Payment session not found");

    await prisma.paymentSession.update({
      where: { id: session.id },
      data: { status: "paid", providerPaymentId: paymentId },
    });

    await prisma.subscription.create({
      data: {
        userId: session.userId,
        planId: session.planId,
        provider: "razorpay",
        externalId: paymentId,
        status: "active",
        startedAt: new Date(),
      },
    });

    await recordAuditEvent({
      actorId: session.userId,
      actorRole: "institution_admin",
      action: "PLAN_PURCHASED",
      ip: "auto",
      details: { orderId, paymentId },
    });

    return true;
  } catch (err: any) {
    logger.error("[PAYMENT] Razorpay verification failed", err);
    throw Errors.Server("Payment verification failed");
  }
};

/* -----------------------------------------------------------------------
   🌐 Stripe Webhook Handler
------------------------------------------------------------------------*/
export const handleStripeWebhook = async (rawBody: Buffer, sig: string) => {
  try {
    const event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );

    switch (event.type) {
      case "checkout.session.completed":
        const session = event.data.object as Stripe.Checkout.Session;
        if (!session.metadata) return;

        const { userId, planId } = session.metadata;

        await prisma.paymentSession.updateMany({
          where: { providerOrderId: session.id },
          data: { status: "paid" },
        });

        await prisma.subscription.create({
          data: {
            userId,
            planId,
            provider: "stripe",
            externalId: session.subscription as string,
            status: "active",
            startedAt: new Date(),
          },
        });

        await recordAuditEvent({
          actorId: userId,
          actorRole: "institution_admin",
          action: "PLAN_PURCHASED",
          ip: "webhook",
          details: { provider: "stripe", sessionId: session.id },
        });

        break;

      case "invoice.payment_failed":
        logger.warn("[STRIPE] Payment failed", event.data.object);
        break;

      case "customer.subscription.deleted":
        logger.info("[STRIPE] Subscription cancelled", event.data.object);
        break;

      default:
        logger.info(`[STRIPE] Event ignored: ${event.type}`);
    }

    return { received: true };
  } catch (err: any) {
    logger.error("[STRIPE] Webhook error", err);
    throw Errors.Server("Webhook handling failed");
  }
};

/* -----------------------------------------------------------------------
   🔁 Cancel Subscription
------------------------------------------------------------------------*/
export const cancelSubscription = async (subscriptionId: string, provider: "razorpay" | "stripe") => {
  try {
    if (provider === "razorpay") {
      await razorpay.subscriptions.cancel(subscriptionId);
    } else {
      await stripe.subscriptions.cancel(subscriptionId);
    }

    await prisma.subscription.updateMany({
      where: { externalId: subscriptionId },
      data: { status: "cancelled", endedAt: new Date() },
    });

    logger.info(`[PAYMENT] Subscription ${subscriptionId} cancelled`);
    return true;
  } catch (err: any) {
    logger.error("[PAYMENT] Subscription cancellation failed", err);
    throw Errors.Server("Cancellation failed");
  }
};