---
name: Quality check & waste insight AI
description: Two read-only AI inventory features (quality photo check, expiry/waste insight) and their non-obvious constraints.
---

Two manager-gated, rate-limited AI features on the Inventory tab, both reusing the
photo-intake plumbing and NEVER auto-writing:

1. **Quality/defect photo check** (`POST /inventory/quality-photo`) — vision call
   assesses a finished pizza/crust photo → plain-language status (pass/warn/fail)
   + confidence + issues. Read-only. The ONLY write is a user-driven "Confirm &
   remember outcome" that calls `saveFacilityKnowledge` into facility-memory
   domain `"quality"` with key `check:${productType}:${todayStr()}`.
2. **Expiry & waste insight** (`POST /inventory/waste-insight`) — server flags
   expired/expiring-soon lots (`flagExpiringItems`, pure, grounded by
   `settings.expirySoonDays`), and only calls the AI when something is at risk;
   returns `{ flagged: [], suggestion: null }` with NO AI call when nothing is
   flagged. Best-effort `recordFacilityKnowledge` domain `"waste"`.

**Key constraints / gotchas:**
- AI prompts grounded via `groundPromptWithMemory` (quality → `["quality"]`,
  waste → `["waste","inventory"]`) — same fail-safe path as other AI features.
- Provider error → 502; image-size cap reuses `MAX_IMAGE_BASE64_CHARS` and 413;
  rate-limit 429 with retryAfter. Clients map all via `photoErrorMessage`.
- Pure server logic lives in `qualityPhoto.ts` / `wasteInsight.ts` (validate /
  buildPrompt / sanitize helpers) with unit tests; routes in `inventory.ts`.
- Contract-first: schemas+paths in `lib/api-spec/openapi.yaml`; clients use the
  hand-written fetch wrappers (not Orval hooks) but server validates via the
  generated Zod bodies. Do NOT change OpenAPI `info.title`.
- **Parity:** web `InventoryTab.tsx` and mobile `app/(tabs)/inventory.tsx` each
  render `QualityCheckCard` + `WasteInsightCard` after `PhotoIntakeCard`,
  manager-gated. Mobile mirrors web behavior with RN primitives (camera via
  ImagePicker + `prepareImageBase64`, Feather icons, FONTS weighted families).
