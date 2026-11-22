import { Router } from "express";
import type { Pool } from "../db/pool.js";

/** Public probes (NFR-04): liveness never touches the database; readiness runs SELECT 1. */
export function healthRouter(pool: Pool, appVersion: string) {
  const router = Router();
  router.get("/health", (_req, res) => {
    res.json({ status: "ok", version: appVersion }); // which release is running (R-08)
  });
  router.get("/ready", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ status: "ready", db: "connected" });
    } catch {
      res.status(503).json({ status: "not_ready", db: "disconnected" });
    }
  });
  return router;
}
