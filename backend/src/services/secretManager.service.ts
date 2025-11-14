// src/services/secretManager.service.ts
import logger from "../logger";

class SecretManagerService {
  private warmed = false;

  async warmUp() {
    if (this.warmed) return;
    // Example: validate required envs
    const required = ["DATABASE_URL", "JWT_SECRET"];
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length) {
      logger.warn(`[SecretManager] Missing critical envs: ${missing.join(", ")}`);
      // Do not throw — let assertCriticalSecrets handle fatal check
    }
    this.warmed = true;
    logger.info("[SecretManager] warmUp complete");
  }

  async getSecret(key: string): Promise<string | null> {
    // Replace with real secret lookup
    return process.env[key] ?? null;
  }

  async setSecret(key: string, value: string) {
    // no-op placeholder
    logger.info(`[SecretManager] setSecret placeholder for ${key}`);
  }
}

export const secretManagerService = new SecretManagerService();
export default secretManagerService;