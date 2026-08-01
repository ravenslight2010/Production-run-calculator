# Production Run Calculator Roadmap

## Current Status (as of 2026-08-01)

### 🟢 Web App (`artifacts/run-calculator`)
- **Status:** Active, production-ready
- **Focus:** Full-featured web UI for floor staff and managers
- **Schedule:** Ongoing improvements through 2026 Q3

### 🟡 Mobile App (`artifacts/run-calculator-mobile`)
- **Status:** Maintenance mode (paused development)
- **Last activity:** 2026-07-06
- **Reason:** Web-first strategy; mobile app not actively used
- **If resuming:** See `.agents/memory/web-mobile-parity.md` for UI/formula sync contracts

---

## Q3 2026 Improvements (Delivered)

### Observability & Monitoring
- ✅ Structured request tracing (request ID propagation)
- ✅ AI metrics logging (call counts, latencies, errors)
- ✅ Sync conflict resolution logging (drift detection)
- ✅ Enhanced error messages for common failures

### Resilience & Reliability
- ✅ AI integration redundancy (fallbacks, retries, circuit breaker)
- ✅ Database connection pool hardening
- ✅ Rate limit cost parity for AI endpoints (prevent API spend blowout)
- ✅ Health check endpoints (Docker + load balancer ready)

### Security & Compliance
- ✅ Audit logging for high-stakes operations (data resets, rule edits, role changes)
- ✅ Auth capability gating tests (regression suite)

### Documentation
- ✅ Mobile pause indicator (clear status for new developers)
- ✅ This roadmap

---

## Next Priorities

### Q4 2026
1. **Performance optimization**
   - Query analysis and indexing improvements
   - Client-side caching strategy refinement
   - Lazy load large forms (cheese recipes, rule conditions)

2. **AI Features Enhancement**
   - Feedback loop: track which diagnoses were correct
   - Incident pattern customization per facility
   - Anomaly detection sensitivity tuning

3. **Offline Resilience**
   - Expand offline-first capabilities (currently day-state only)
   - Better sync status UI (show what's pending, what's failed)
   - Batch retries for failed writes

4. **Facility Knowledge Base**
   - Editor for production rules
   - Incident root cause library (editable, facility-specific)
   - Recipe approval workflow

### Q1 2027 (Future)
1. **Mobile Resumption** (if business case confirmed)
   - Sync web+mobile UI to current parity state
   - Revalidate all formula differences
   - Full E2E test suite

2. **Analytics Dashboard**
   - Production trends (OEE, cycle time)
   - Downtime root cause breakdown
   - Staff performance (optional, compliance-aware)

3. **Integration Ecosystem**
   - QuickBooks sync for COGS
   - Demand forecasting API
   - Warehouse management system bridge

---

## Architecture Notes

### Database Schema
- **Source of truth:** `lib/db/src/schema/*` (Drizzle ORM)
- **Migrations:** `pnpm --filter @workspace/db run push`
- **Audit trail:** New `audit_logs` and `sync_conflict_logs` tables for compliance

### API Contract
- **Spec:** `lib/api-spec/openapi.yaml`
- **Codegen:** `pnpm --filter @workspace/api-spec run codegen`
- **Validation:** Zod schemas in `@workspace/api-zod`

### Shared Logic
- **Location:** `lib/*` packages
- **No app-specific code:** Keep web/mobile thin; logic in libs
- **Parity guarantee:** Every formula/decision must be identical across clients

### Resilience Patterns (New)
- **AI fallback:** Deterministic clustering when OpenAI unavailable
- **Circuit breaker:** Fail fast if Google GenAI is degraded
- **Rate limit cost parity:** AI endpoints charged 5-20x vs. regular endpoints
- **Sync conflict logging:** Debug offline-first drift issues

---

## Known Constraints

### Mobile (Paused)
- Expo web SSE has connection pooling limits (see `runtest-expo-web-quirks.md`)
- RN font weights differ from web (see `.agents/memory/`)
- Cannot render web components in isolation (inline + parity guards only)

### Data Safety
- DB schema changes must be additive on populated tables
- Use `pnpm --filter @workspace/db run push-force` in containers (TTY rename prompt workaround)
- Sync merges are additive-union; tombstones required for deletions

### Auth Boundary
- `/healthz`, `/auth/*` exempt from authentication
- All `/api/*` endpoints require valid bearer token or httpOnly cookie
- Capability gating is role-based (roles stored in Postgres, not hardcoded)

---

## For New Contributors

### Setup
```bash
pnpm install
pnpm run typecheck
pnpm --filter @workspace/api-server run dev  # API on :5000
pnpm --filter @workspace/run-calculator run dev  # Web on :5173
```

### Before Opening a PR
1. Run `pnpm run typecheck` (catches import errors, circular deps)
2. For any `lib/*` change: `pnpm run typecheck:libs` first
3. If modifying auth: add a capability gating test
4. If touching sync: check `sync_conflict_logs` observability
5. For AI features: add fallback behavior

### Deep Dives
- **Offline-first sync:** `.agents/memory/live-sync-web-mobile.md`
- **Web/mobile parity:** `.agents/memory/web-mobile-parity.md`
- **API error handling:** `.agents/memory/api-json-error-handler.md`
- **DB schema safety:** `.agents/memory/additive-push-force-schema.md`

---

## Contact
- **Owner:** [@ravenslight2010](https://github.com/ravenslight2010)
- **Issues:** GitHub Issues in this repo
- **Discussions:** GitHub Discussions (for feature ideation)
