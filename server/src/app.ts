import express from "express";
import type { Config } from "./config.js";
import type { Pool } from "./db/pool.js";
import { errorHandler, notFoundHandler } from "./errors.js";

export interface AppOptions {
  config: Config;
  pool: Pool;
}

/** Builds the Express app. Routes are added feature by feature. */
export function createApp({ config }: AppOptions) {
  const app = express();
  app.disable("x-powered-by");
  if (config.isProduction) app.set("trust proxy", 1);
  app.use(express.json({ limit: "10kb" }));

  app.use("/api", notFoundHandler);
  app.use(errorHandler);
  return app;
}
