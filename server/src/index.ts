import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";

const here = path.dirname(fileURLToPath(import.meta.url));

try {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl, config.poolMax);
  const clientDist = path.resolve(here, "..", "..", "client", "dist");
  const app = createApp({ config, pool, clientDist });
  app.listen(config.port, "0.0.0.0", () => {
    console.log(`Omkoi Station API listening on port ${config.port} (${config.nodeEnv})`);
  });
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
