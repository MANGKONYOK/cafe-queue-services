import pg from "pg";

export type Pool = pg.Pool;

/** Default connections per process; Cloud Run lowers it with PG_POOL_MAX (deployment design D-1). */
export const DEFAULT_POOL_MAX = 10;

export function createPool(connectionString: string, max: number = DEFAULT_POOL_MAX): pg.Pool {
  // A short connect timeout lets /api/ready answer 503 quickly when the database is down (NFR-04).
  return new pg.Pool({ connectionString, connectionTimeoutMillis: 2000, max });
}
