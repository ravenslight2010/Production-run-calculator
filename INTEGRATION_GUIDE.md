# Integration Guide: 10 Improvements (Observability, Resilience, Auth, Auditing)

This guide helps you complete the wire-up of all 10 improvements into your existing codebase.

## Files Already Created

The following files are **fully functional** and ready to use:

1. ✅ `artifacts/api-server/src/lib/tracing.ts` — Structured tracing types
2. ✅ `artifacts/api-server/src/lib/resilience.ts` — Retry + circuit breaker
3. ✅ `artifacts/api-server/src/lib/rateLimitCost.ts` — Cost-based rate limiting
4. ✅ `artifacts/api-server/src/lib/dbResilience.ts` — Connection pool hardening
5. ✅ `artifacts/api-server/src/lib/openAiClient.ts` — NEW: OpenAI with circuit breaker (added in integration)
6. ✅ `artifacts/api-server/src/routes/healthz.ts` — Health check endpoint
7. ✅ `artifacts/api-server/src/routes/auditLogs.ts` — Audit log queries
8. ✅ `artifacts/api-server/src/middleware/errorMessagesEnhanced.ts` — Better error messages
9. ✅ `artifacts/api-server/src/middleware/costLimitMiddleware.ts` — NEW: Cost limit factory (added in integration)
10. ✅ `artifacts/api-server/src/routes/authCapabilityTests.test.ts` — Auth tests
11. ✅ `lib/db/src/schema/auditLog.ts` — Audit log table
12. ✅ `lib/db/src/schema/syncConflictLog.ts` — Sync conflict log table
13. ✅ `ROADMAP.md` + `artifacts/run-calculator-mobile/MAINTENANCE_MODE.md` — Docs

## Integration Steps

### Step 1: Update Database Exports

**File:** `lib/db/src/schema/index.ts`

Add these exports:

```typescript
export * from './auditLog';
export * from './syncConflictLog';
```

### Step 2: Run Database Migrations

```bash
pnpm --filter @workspace/db run push
```

This creates the `audit_logs` and `sync_conflict_logs` tables.

### Step 3: Update `app.ts` (Already Done)

**File:** `artifacts/api-server/src/app.ts`

The updated version includes:
- Import of `healthzRouter` → Health checks mounted at `/healthz`
- Import of `enhancedErrorMessages` → Better error messages throughout
- Both are already wired in the new version

### Step 4: Update Sync Route (Factory Reset Audit Logging)

**File:** `artifacts/api-server/src/routes/sync.ts`

Find the `POST /sync/reset` endpoint (around line 416) and add audit logging:

```typescript
import { logAuditEvent } from './auditLogs';

router.post(
  "/sync/reset",
  requireCapability("manage-staff"),
  async (_req: Request, res: Response): Promise<void> => {
    const scope = currentScope();
    const actor = (_req as any).user?.username || "unknown";
    
    const epoch = await db.transaction(async (tx) => {
      const result = await tx
        .delete(dailySyncTable)
        .where(eq(dailySyncTable.scope, scope));
      const deletedCount = result.count ?? 0;
      
      // ... rest of reset logic ...
      return row?.epoch ?? 0;
    });
    
    // Log the audit event
    await logAuditEvent(
      scope,
      actor,
      'factory_reset',
      'daily_sync',
      { deleted_days: deletedCount },
      _req.ip,
      _req.headers['user-agent'] as string | undefined
    );
    
    broadcastReset(scope, epoch);
    res.json({ ok: true, epoch });
  },
);
```

### Step 5: Update Production Rules Route (Audit Logging)

**File:** `artifacts/api-server/src/routes/productionRules.ts`

Add audit logging to both POST and DELETE endpoints:

```typescript
import { logAuditEvent } from './auditLogs';

router.post(
  "/production-rules",
  requireCapability("edit-production-rules"),
  async (req: Request, res: Response) => {
    const actor = (req as any).user?.username || "unknown";
    // ... existing validation ...
    
    try {
      for (const rule of byId.values()) {
        // ... upsert logic ...
      }
      const rules = await listAll();
      
      // Add audit logging
      await logAuditEvent(
        currentScope(),
        actor,
        'production_rules_updated',
        'production_rules',
        { rule_count: byId.size }
      );
      
      res.json({ rules });
    } catch (err) {
      req.log.error({ err }, "failed to save production rules");
      res.status(500).json({ error: "Failed to save production rules" });
    }
  },
);

router.delete(
  "/production-rules",
  requireCapability("edit-production-rules"),
  async (req: Request, res: Response) => {
    const actor = (req as any).user?.username || "unknown";
    // ... existing validation ...
    
    try {
      if (ids.length > 0) {
        await db.delete(productionRulesTable).where(/* ... */);
      }
      const rules = await listAll();
      
      // Add audit logging
      await logAuditEvent(
        currentScope(),
        actor,
        'production_rules_deleted',
        'production_rules',
        { deleted_ids: ids }
      );
      
      res.json({ rules });
    } catch (err) {
      req.log.error({ err }, "failed to delete production rules");
      res.status(500).json({ error: "Failed to delete production rules" });
    }
  },
);
```

### Step 6: Register Routes (Register New Routes)

**File:** `artifacts/api-server/src/routes/index.ts` (main router file)

Add these imports and registrations:

```typescript
import auditLogsRouter from './auditLogs';
import { aiCostLimit } from '../middleware/costLimitMiddleware';

// Register audit logs route
router.use(auditLogsRouter);

// Apply cost limit to all AI endpoints
router.use('/ai', aiCostLimit);
```

### Step 7: Optional - Add Tracing to AI Routes

For any AI endpoint (e.g., `/api/ai/diagnose-issue`, `/api/ai/cluster-incidents`):

```typescript
import { logAiMetric } from '../lib/tracing';

router.post('/ai/some-endpoint', async (req, res) => {
  const startMs = Date.now();
  
  try {
    const result = await someExpensiveOperation();
    
    logAiMetric({
      endpoint: 'some-endpoint',
      model: 'gpt-4',
      durationMs: Date.now() - startMs,
      inputTokens: result.usage?.prompt_tokens ?? 0,
      outputTokens: result.usage?.completion_tokens ?? 0,
      status: 'success',
      metadata: { /* optional metadata */ },
    }, req.log);
    
    res.json(result);
  } catch (err) {
    logAiMetric({
      endpoint: 'some-endpoint',
      model: 'gpt-4',
      durationMs: Date.now() - startMs,
      status: 'error',
      errorCode: (err as any).code,
      errorMessage: (err as any).message,
    }, req.log);
    throw err;
  }
});
```

### Step 8: Optional - Replace OpenAI Calls

If your AI routes use OpenAI directly, replace with the resilient wrapper:

```typescript
// Before:
const result = await openai.chat.completions.create({ /* ... */ });

// After:
import { callOpenAiWithResilience, callOpenAiJsonWithResilience } from '../lib/openAiClient';

const result = await callOpenAiWithResilience(
  systemPrompt,
  'gpt-4-turbo',
  { maxTokens: 2000 }
);

// For JSON responses:
const result = await callOpenAiJsonWithResilience(
  systemPrompt,
  userPrompt,
  'gpt-4-turbo'
);
```

## Testing

### 1. Run Migrations

```bash
pnpm --filter @workspace/db run push
```

### 2. Type Check

```bash
pnpm run typecheck
```

### 3. Run Auth Tests

```bash
pnpm exec vitest run artifacts/api-server/src/routes/authCapabilityTests.test.ts
```

### 4. Test Health Endpoint

```bash
curl http://localhost:5000/healthz
```

Expected response (all healthy):

```json
{
  "status": "healthy",
  "checks": {
    "database": "ok"
  },
  "timestamp": "2026-08-01T12:00:00.000Z"
}
```

### 5. Test Enhanced Error Messages

Try an invalid request:

```bash
curl -X POST http://localhost:5000/api/some-endpoint \
  -H "Content-Type: application/json" \
  -d "{invalid json"
```

Expected: `{ "error": "The request body was not valid JSON." }`

### 6. Test Audit Logging

After a factory reset, query audit logs:

```bash
curl http://localhost:5000/api/audit-logs?scope=live \
  -H "Authorization: Bearer <manager-token>"
```

### 7. Test Cost Limit

Hit an AI endpoint repeatedly:

```bash
for i in {1..50}; do 
  curl http://localhost:5000/api/ai/cluster-incidents \
    -H "Authorization: Bearer <token>" \
    -H "Content-Type: application/json" \
    -d '{"lookbackDays": 30}'
 done
```

After ~300 cost units, you should get 429 (Too Many Requests).

## Checklist

- [ ] Database migrations run (`pnpm --filter @workspace/db run push`)
- [ ] `lib/db/src/schema/index.ts` exports new audit tables
- [ ] `artifacts/api-server/src/app.ts` uses new error handler + health route
- [ ] `artifacts/api-server/src/routes/sync.ts` logs factory resets
- [ ] `artifacts/api-server/src/routes/productionRules.ts` logs rule changes
- [ ] `artifacts/api-server/src/routes/index.ts` registers audit logs + cost limit
- [ ] Typecheck passes: `pnpm run typecheck`
- [ ] Tests pass: `pnpm exec vitest run artifacts/api-server/src/routes/authCapabilityTests.test.ts`
- [ ] Health endpoint works: `curl http://localhost:5000/healthz`
- [ ] Error messages are helpful (test with malformed JSON)

## Support

For issues during integration:

1. Check `ROADMAP.md` for context
2. Review `.agents/memory/` for architectural patterns
3. Ensure all 12 files are present in the branch
4. Run `pnpm run typecheck` to catch import/schema errors
