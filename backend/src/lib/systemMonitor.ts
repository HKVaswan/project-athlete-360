import os from "os";
import { performance } from "perf_hooks";
import { logger } from "../logger";
import { queues } from "../workers";
import { config } from "../config";

interface SystemMetrics {
  timestamp: string;
  cpuUsage: number;
  memoryUsage: number;
  loadAverage: number[];
  activeQueues: number;
  jobBacklog: Record<string, number>;
  latencyMs: number;
  environment: string;
  uptimeMinutes: number;
}

/**
 * Get CPU and memory utilization
 */
const getSystemStats = (): { cpuUsage: number; memoryUsage: number; loadAverage: number[] } => {
  const cpus = os.cpus();
  const totalIdle = cpus.reduce((acc, cpu) => acc + cpu.times.idle, 0);
  const totalTick = cpus.reduce(
    (acc, cpu) => acc + Object.values(cpu.times).reduce((a, b) => a + b, 0),
    0
  );
  const cpuUsage = 1 - totalIdle / totalTick;

  const memoryUsage = process.memoryUsage().rss / os.totalmem();
  const loadAverage = os.loadavg();

  return {
    cpuUsage: Number((cpuUsage * 100).toFixed(2)),
    memoryUsage: Number((memoryUsage * 100).toFixed(2)),
    loadAverage: loadAverage.map((v) => Number(v.toFixed(2))),
  };
};

/**
 * Measure internal latency (event loop delay simulation)
 */
const measureLatency = async (): Promise<number> => {
  const start = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const end = performance.now();
  return Number((end - start).toFixed(2));
};

/**
 * Collect queue metrics (job backlog)
 */
const getQueueMetrics = async (): Promise<Record<string, number>> => {
  const result: Record<string, number> = {};
  for (const [name, queue] of Object.entries(queues)) {
    try {
      const count = await queue.getWaitingCount();
      result[name] = count;
    } catch (err) {
      result[name] = -1;
    }
  }
  return result;
};

/**
 * Aggregates all metrics into a unified snapshot
 */
export const getSystemMetrics = async (): Promise<SystemMetrics> => {
  const { cpuUsage, memoryUsage, loadAverage } = getSystemStats();
  const latencyMs = await measureLatency();
  const jobBacklog = await getQueueMetrics();

  return {
    timestamp: new Date().toISOString(),
    cpuUsage,
    memoryUsage,
    loadAverage,
    latencyMs,
    activeQueues: Object.keys(queues).length,
    jobBacklog,
    environment: config.nodeEnv || "development",
    uptimeMinutes: Math.floor(process.uptime() / 60),
  };
};

/**
 * Log metrics periodically for observability dashboards
 */
export const startSystemMonitor = (intervalMs = 60000) => {
  logger.info(`[MONITOR] 🧠 Starting system monitor every ${intervalMs / 1000}s...`);
  setInterval(async () => {
    try {
      const metrics = await getSystemMetrics();
      logger.info("[MONITOR] 📊 System metrics snapshot", metrics);

      if (metrics.cpuUsage > 85 || metrics.memoryUsage > 85) {
        logger.warn("[MONITOR] ⚠️ High resource usage detected!", metrics);
      }
    } catch (err) {
      logger.error("[MONITOR] ❌ System monitor error:", err);
    }
  }, intervalMs);
};