// src/config/index.ts
import dotenv from "dotenv";
import path from "path";
import Joi from "joi";

// Load .env (Render or Docker injects directly, but local dev uses this)
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

// Define schema for all required environment variables
const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid("development", "production", "test").default("development"),
  PORT: Joi.number().default(5000),

  DATABASE_URL: Joi.string().uri().required(),
  JWT_SECRET: Joi.string().min(20).required(),
  JWT_EXPIRES_IN: Joi.string().default("7d"),

  FRONTEND_URL: Joi.string().uri().required(),

  REDIS_URL: Joi.string().uri().optional(),
  EMAIL_FROM: Joi.string().email().optional(),

  AWS_S3_BUCKET: Joi.string().optional(),
  AWS_ACCESS_KEY_ID: Joi.string().optional(),
  AWS_SECRET_ACCESS_KEY: Joi.string().optional(),
  AWS_REGION: Joi.string().optional(),

  LOG_LEVEL: Joi.string()
    .valid("error", "warn", "info", "http", "verbose", "debug", "silly")
    .default("info"),

  SENTRY_DSN: Joi.string().allow("").optional(),
}).unknown(); // allow other vars (Render injects many automatically)

// Validate environment
const { value: env, error } = envSchema.validate(process.env, { abortEarly: false });
if (error) {
  console.error("❌ Invalid environment configuration:");
  error.details.forEach((d) => console.error(`   - ${d.message}`));
  process.exit(1);
}

// Final typed config object
export const config = {
  nodeEnv: env.NODE_ENV,
  isProd: env.NODE_ENV === "production",
  port: env.PORT,
  dbUrl: env.DATABASE_URL,
  jwt: {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN,
  },
  frontendUrl: env.FRONTEND_URL,
  redisUrl: env.REDIS_URL,
  email: {
    from: env.EMAIL_FROM,
  },
  aws: {
    bucket: env.AWS_S3_BUCKET,
    region: env.AWS_REGION,
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
  logLevel: env.LOG_LEVEL,
  sentryDsn: env.SENTRY_DSN,
} as const;

export default config;
