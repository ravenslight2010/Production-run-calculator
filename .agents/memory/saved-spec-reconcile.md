---
name: Saved spec sheets + AI cross-reference
description: Server-saved (max 2) imported spec sheets cross-referenced against the CURRENT recipe library; deterministic diff in a shared lib, AI only narrates.
---

# Saved spec sheets + AI reconcile

Keep up to the **2 most recently imported** spec sheets server-side so they can
later be cross-referenced against the *current* recipe library ("does the recipe
still match the spec?"). The discrepancy list is always deterministic; the AI
only writes a plain-language summary of an already-computed diff.

## Layering (keep both apps thin)
- Pure diff lives in `@workspace/spec-reconcile`: `reconcileSpecWithRecipes` →
  discrepancy list of kinds `missing-recipe` / `missing-ingredient` /
  `extra-ingredient` / `amount-mismatch`. Match by kind+name case-insensitively;
  compare ingredient sets + lbs with tolerance. Same lib runs on server AND both
  clients. 15 unit tests, workflow `test:spec-reconcile`.
- DB: `saved_spec_sheets` (id, scope, label, data jsonb=ParsedSpecImport,
  createdAt). Scope-isolated like `spec_import_aliases`. Prune-to-2 on save.
- Server: `savedSpecSheets.ts` CRUD (`GET/POST /spec-sheets`,
  `DELETE /spec-sheets/{id}`) + `/ai/spec-reconcile` in `ai.ts`.

## Non-obvious decisions / gotchas
- **`/ai/spec-reconcile` is a paid AI endpoint → it MUST carry `rateLimit`** like
  every other `/ai/*` route (per-user fixed window, Postgres store in prod).
  Missing it is a cost-exhaustion hole an architect review will (correctly) block on.
  **Why:** any signed-in user can otherwise hammer OpenAI uncapped.
- **AI is fail-safe:** AI summary failure returns the deterministic discrepancies
  with an empty summary, never a 502. The diff is the source of truth.
- **Not manager-gated** — `requireAuth` only (any signed-in worker can check).
- Clients send a `currentRecipes` snapshot built from their recipe presets; the
  server derives `scope` itself (never trust a client scope).
- Auto-save snapshot is wired into `commitSpecImport` on both apps (best-effort;
  a save failure must not break the import).
- Integration test (`savedSpecSheets.integration.test.ts`) drives scope via a
  test-only `x-test-scope` header wrapping each request in `runWithScope`
  (live/sandbox) — real scope comes from the authed user via AsyncLocalStorage,
  there is no header mechanism in prod.
