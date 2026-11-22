import { z } from "zod";
import { DEFAULT_POOL_MAX } from "./db/pool.js";

/** The value `.env.example` ships with; never acceptable in production (NFR-02). */
export const PLACEHOLDER = "change-me";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(1),
  // Connections per process. Cloud Run sets 5 so 3 instances stay under db-f1-micro's 25 (deployment design D-1).
  PG_POOL_MAX: z.coerce.number().int().min(1).max(50).default(DEFAULT_POOL_MAX),
});

export interface Config {
  nodeEnv: "development" | "test" | "production";
  isProduction: boolean;
  port: number;
  databaseUrl: string;
  sessionSecret: string;
  poolMax: number;
}

export class ConfigError extends Error {}

/** Reads configuration from the environment only. Throws instead of falling back to a default secret. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // An empty value (KEY= copied from .env.example) counts as not set.
  const present = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = schema.safeParse(present);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ");
    throw new ConfigError(`Invalid configuration: ${names} missing or invalid.`);
  }
  const c = parsed.data;
  const isProduction = c.NODE_ENV === "production";
  if (isProduction && (c.SESSION_SECRET === PLACEHOLDER || c.SESSION_SECRET.length < 32)) {
    throw new ConfigError("SESSION_SECRET must be a random value of at least 32 characters in production.");
  }
  return {
    nodeEnv: c.NODE_ENV,
    isProduction,
    port: c.PORT,
    databaseUrl: c.DATABASE_URL,
    sessionSecret: c.SESSION_SECRET,
    poolMax: c.PG_POOL_MAX,
  };
}
