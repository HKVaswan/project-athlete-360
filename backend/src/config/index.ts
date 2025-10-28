// src/config/index.ts
import dotenv from "dotenv";
import { z } from "zod";
import path from "path";

// Load environment variables from .env if not in production
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

// ───────────────────────────────
// 🧩 Define environment schema using Zod
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(5000),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  JWT_SECRET: z.string().min(10, "JWT_SECRET is required and must be strong"),
  JWT_EXPIRES_IN: z.string().default("1h"),

  REFRESH_TOKEN_SECRET: z
    .string()
    .min(10, "REFRESH_TOKEN_SECRET is required")
    .default("refresh_secret_key"),

  FRONTEND_URL: z.string().url().default("http://localhost:5173"),

  REDIS_URL: z.string().optional(),
  S3_BUCKET_NAME: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),

  EMAIL_FROM: z.string().email().optional(),
  EMAIL_SMTP_HOST: z.string().optional(),
  EMAIL_SMTP_PORT: z.coerce.number().optional(),
  EMAIL_SMTP_USER: z.string().optional(),
  EMAIL_SMTP_PASS: z.string().optional(),
});

// ───────────────────────────────
// ✅ Parse and validate environment
const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error("❌ Invalid environment configuration:");
  console.error(parsedEnv.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  nodeEnv: parsedEnv.data.NODE_ENV,
  isProd: parsedEnv.data.NODE_ENV === "production",
  isDev: parsedEnv.data.NODE_ENV === "development",
  port: parsedEnv.data.PORT,

  db: {
    url: parsedEnv.data.DATABASE_URL,
  },

  jwt: {
    secret: parsedEnv.data.JWT_SECRET,
    expiresIn: parsedEnv.data.JWT_EXPIRES_IN,
    refreshSecret: parsedEnv.data.REFRESH_TOKEN_SECRET,
  },

  redis: {
    url: parsedEnv.data.REDIS_URL,
  },

  s3: {
    bucket: parsedEnv.data.S3_BUCKET_NAME,
    region: parsedEnv.data.S3_REGION,
    accessKey: parsedEnv.data.S3_ACCESS_KEY,
    secretKey: parsedEnv.data.S3_SECRET_KEY,
  },

  mail: {
    from: parsedEnv.data.EMAIL_FROM,
    host: parsedEnv.data.EMAIL_SMTP_HOST,
    port: parsedEnv.data.EMAIL_SMTP_PORT,
    user: parsedEnv.data.EMAIL_SMTP_USER,
    pass: parsedEnv.data.EMAIL_SMTP_PASS,
  },

  frontendUrl: parsedEnv.data.FRONTEND_URL,
} as const;

// ───────────────────────────────
// 🧾 Summary Log (only in dev)
if (config.isDev) {
  console.log("✅ Loaded environment configuration:");
  console.table({
    NODE_ENV: config.nodeEnv,
    PORT: config.port,
    FRONTEND_URL: config.frontendUrl,
    DATABASE_URL: config.db.url ? "[HIDDEN]" : "❌ Missing",
    REDIS_URL: config.redis.url ? "[Set]" : "Not Set",
  });
}

export type AppConfig = typeof config;
