import { Router, Request, Response } from 'express';
import { db } from '@workspace/db';
import { logger } from '../lib/logger';

/**
 * Health check endpoint for Docker health checks and load balancers.
 * Returns 200 only if all critical services are healthy.
 */

const router = Router();

router.get('/healthz', async (_req: Request, res: Response) => {
  const checks: Record<string, string> = {
    database: 'ok',
  };

  // Check database
  try {
    await db.execute({
      sql: 'SELECT 1',
      params: [],
    } as any);
  } catch (err) {
    checks.database = `error: ${(err as any).message || 'unknown'}`;
  }

  // Optional: Check external services if critical to your app
  // For now, just database is required.

  const allHealthy = Object.values(checks).every((c) => c === 'ok');
  const statusCode = allHealthy ? 200 : 503;

  res.status(statusCode).json({
    status: allHealthy ? 'healthy' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
  });
});

export default router;
