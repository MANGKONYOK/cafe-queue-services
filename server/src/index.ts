import "dotenv/config";
import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";

try {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const app = createApp({ config, pool });
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
