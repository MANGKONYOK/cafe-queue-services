import pg from "pg";

export type Pool = pg.Pool;

export function createPool(connectionString: string): pg.Pool {
  // A short connect timeout lets /api/ready answer 503 quickly when the database is down (NFR-04).
  return new pg.Pool({ connectionString, connectionTimeoutMillis: 2000, max: 10 });
}
