// backend/src/config/index.ts
import dotenv from "dotenv";
import Joi from "joi";
import path from "path";

dotenv.config({
  path: process.env.NODE_ENV === "test" ? path.resolve(".env.test") : undefined,
});

const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid("development", "test", "production").default("development"),
  PORT: Joi.number().default(10000),
  DATABASE_URL: Joi.string().uri().required(),
  JWT_SECRET: Joi.string().min(16).required(),
  JWT_EXPIRES_IN: Joi.string().default("7d"),
  REFRESH_TOKEN_SECRET: Joi.string().min(16).allow("").default(""),
  FRONTEND_URL: Joi.string().uri().allow("").default(""),
  REDIS_URL: Joi.string().allow("").default(""),
  SENTRY_DSN: Joi.string().allow("").default(""),
  LOG_LEVEL: Joi.string().valid("error", "warn", "info", "http", "verbose", "debug", "silly").default("info"),
}).unknown(true);

const { error, value: env } = envSchema.validate(process.env, { abortEarly: false });

if (error) {
  /* eslint-disable no-console */
  console.error("❌ Invalid environment configuration:");
  error.details.forEach((d) => console.error(`  • ${d.message}`));
  process.exit(1);
  /* eslint-enable no-console */
}

export const config = {
  env: env.NODE_ENV as "development" | "test" | "production",
  port: Number(env.PORT),
  databaseUrl: env.DATABASE_URL as string,
  jwt: {
    secret: env.JWT_SECRET as string,
    expiresIn: env.JWT_EXPIRES_IN as string,
    refreshSecret: env.REFRESH_TOKEN_SECRET as string,
  },
  frontendUrl: env.FRONTEND_URL as string,
  redisUrl: env.REDIS_URL as string,
  sentryDsn: env.SENTRY_DSN as string,
  logLevel: env.LOG_LEVEL as string,
};
