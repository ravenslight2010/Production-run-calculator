import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer, TestUser } from '../test-utils';

/**
 * Regression tests: every AI endpoint validates capability gating.
 * Ensures that new roles without required capabilities are blocked.
 */

describe('Auth capability gating on AI endpoints', () => {
  let server: any;
  let managerToken: string;
  let operatorToken: string;
  let operatorNoIssueToken: string;

  beforeAll(async () => {
    server = await createTestServer();

    // Create test users with different capabilities
    const manager = await server.createUser('manager-test', 'password123', {
      role: 'manager',
    });
    managerToken = manager.token;

    const operator = await server.createUser('operator-test', 'password123', {
      role: 'operator',
    });
    operatorToken = operator.token;

    // Operator without 'report-issue' capability
    const operatorNoIssue = await server.createUser(
      'operator-no-issue',
      'password123',
      { role: 'operator', excludeCapabilities: ['report-issue'] }
    );
    operatorNoIssueToken = operatorNoIssue.token;
  });

  afterAll(async () => {
    await server.close();
  });

  describe('POST /api/ai/diagnose-issue', () => {
    it('allows manager to report issues', async () => {
      const res = await server.request
        .post('/api/ai/diagnose-issue')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ description: 'Line stopped unexpectedly' });

      expect([200, 400, 503]).toContain(res.status); // 400 for validation, 503 for API unavailable
      expect(res.status).not.toBe(403);
    });

    it('allows operator with report-issue capability', async () => {
      const res = await server.request
        .post('/api/ai/diagnose-issue')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ description: 'Line stopped unexpectedly' });

      expect([200, 400, 503]).toContain(res.status);
      expect(res.status).not.toBe(403);
    });

    it('denies operator without report-issue capability', async () => {
      const res = await server.request
        .post('/api/ai/diagnose-issue')
        .set('Authorization', `Bearer ${operatorNoIssueToken}`)
        .send({ description: 'Line stopped unexpectedly' });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/capability|permission/i);
    });
  });

  describe('POST /api/ai/cluster-incidents', () => {
    it('requires manage-staff capability', async () => {
      const resOperator = await server.request
        .post('/api/ai/cluster-incidents')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ lookbackDays: 30 });

      expect(resOperator.status).toBe(403);

      const resManager = await server.request
        .post('/api/ai/cluster-incidents')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ lookbackDays: 30 });

      expect([200, 400, 503]).toContain(resManager.status);
    });
  });

  describe('POST /api/production-rules', () => {
    it('requires manage-production capability', async () => {
      const resOperator = await server.request
        .post('/api/production-rules')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ type: 'enforce', condition: 'app1Lbs > 50' });

      expect(resOperator.status).toBe(403);

      const resManager = await server.request
        .post('/api/production-rules')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ type: 'enforce', condition: 'app1Lbs > 50' });

      expect([200, 400, 500]).toContain(resManager.status);
      expect(resManager.status).not.toBe(403);
    });
  });
});
