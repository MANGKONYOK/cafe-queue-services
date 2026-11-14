import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { Config } from "./config.js";
import type { Pool } from "./db/pool.js";
import { errorHandler, notFoundHandler } from "./errors.js";
import { authRouter } from "./routes/auth.js";
import { categoriesRouter } from "./routes/categories.js";
import { healthRouter } from "./routes/health.js";
import { sessionMiddleware } from "./session.js";

export interface AppOptions {
  config: Config;
  pool: Pool;
  /** Built client (client/dist); served from the same origin when present. */
  clientDist?: string;
}

export function createApp({ config, pool, clientDist }: AppOptions) {
  const app = express();
  app.disable("x-powered-by");
  if (config.isProduction) app.set("trust proxy", 1); // Secure cookies behind Cloud Run's proxy
  app.use(express.json({ limit: "10kb" }));

  app.use("/api", healthRouter(pool));
  app.use("/api", sessionMiddleware(config, pool));
  app.use("/api/auth", authRouter(config, pool));
  app.use("/api/categories", categoriesRouter(pool));
  app.use("/api", notFoundHandler);

  if (clientDist && fs.existsSync(path.join(clientDist, "index.html"))) {
    app.use(express.static(clientDist));
    app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
  }

  app.use(errorHandler);
  return app;
}
