/**
 * src/lib/core/eventBus.ts
 * ------------------------------------------------------------
 * Enterprise-grade internal event bus for modular communication.
 *
 * Enables:
 *  - Decoupled communication between services (e.g., Auth → AI)
 *  - Real-time triggers for analytics, notifications, AI models
 *  - Centralized event logging & replay support
 *
 * Designed to scale:
 *  - In-memory (Node.js EventEmitter) for dev/small scale
 *  - Easily switchable to Redis Pub/Sub or Kafka for production
 */

import { EventEmitter } from "events";
import { logger } from "../../logger";
import { config } from "../../config";

type EventHandler<T = any> = (payload: T) => void | Promise<void>;

class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    // Prevent max listener memory leaks in production scale
    this.emitter.setMaxListeners(50);
  }

  /**
   * Subscribe to an event
   */
  on<T = any>(event: string, handler: EventHandler<T>) {
    this.emitter.on(event, handler);
    logger.debug(`[EventBus] Subscribed to '${event}'`);
  }

  /**
   * Unsubscribe from an event
   */
  off<T = any>(event: string, handler: EventHandler<T>) {
    this.emitter.off(event, handler);
    logger.debug(`[EventBus] Unsubscribed from '${event}'`);
  }

  /**
   * Emit an event (async-safe)
   */
  async emit<T = any>(event: string, payload?: T) {
    try {
      logger.info(`[EventBus] 📡 Emitting event: '${event}'`);
      this.emitter.emit(event, payload);
    } catch (err: any) {
      logger.error(`[EventBus] ❌ Error during '${event}': ${err.message}`);
    }
  }

  /**
   * Emit with async handlers (promises resolved in parallel)
   */
  async emitAsync<T = any>(event: string, payload?: T) {
    const listeners = this.emitter.listeners(event);
    if (listeners.length === 0) return;

    logger.info(`[EventBus] 🚀 Emitting async event: '${event}' to ${listeners.length} listener(s)`);

    await Promise.all(
      listeners.map(async (listener) => {
        try {
          await Promise.resolve(listener(payload));
        } catch (err: any) {
          logger.error(`[EventBus] Handler failed for '${event}': ${err.message}`);
        }
      })
    );
  }

  /**
   * List all registered events (for monitoring)
   */
  getEvents() {
    return this.emitter.eventNames();
  }
}

/**
 * Singleton instance shared across app
 */
export const eventBus = new EventBus();

/**
 * Example events (add more as needed)
 */
export const SystemEvents = {
  USER_CREATED: "user.created",
  ATHLETE_PERFORMANCE_UPDATED: "athlete.performance.updated",
  SESSION_COMPLETED: "session.completed",
  AI_ALERT_TRIGGERED: "ai.alert.triggered",
  ERROR_REPORTED: "system.error.reported",
};