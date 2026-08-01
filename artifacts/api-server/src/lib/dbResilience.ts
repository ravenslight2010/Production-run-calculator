import { Pool } from "pg";
import { Logger } from "pino";

/**
 * Database connection pool configuration and health monitoring.
 * Prevents connection exhaustion under high concurrency (especially mobile SSE).
 */

export interface PoolOptions {
  connectionString: string;
  max?: number; // Max concurrent connections (default: 20)
  idleTimeoutMillis?: number; // Close idle connections (default: 30s)
  connectionTimeoutMillis?: number; // Fail fast on connect (default: 5s)
}

export function createResilientPool(
  options: PoolOptions,
  log: Logger,
): Pool {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.max ?? 20,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 30000,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5000,
    application_name: "production-run-calculator",
  });

  // Health check: validate pool periodically
  const healthCheckInterval = setInterval(async () => {
    try {
      const client = await pool.connect();
      await client.query("SELECT 1");
      client.release();
      log.debug("Pool health check passed");
    } catch (err) {
      log.error({ err }, "Pool health check failed");
    }
  }, 60000); // Every 60 seconds

  // Cleanup on shutdown
  process.on("SIGTERM", async () => {
    clearInterval(healthCheckInterval);
    await pool.end();
  });

  return pool;
}
