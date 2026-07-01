---
name: Saved spec sheets + AI cross-reference
description: Server-saved imported spec/premix sheets (2 most recent PER distinct file) cross-referenced against the CURRENT recipe/profile library; deterministic diff in a shared lib, AI only narrates.
---

# Saved spec sheets + AI reconcile

Keep the imported spec sheets server-side so they can later be cross-referenced
against the *current* recipe library ("does the recipe still match the spec?").
The discrepancy list is always deterministic; the AI only writes a plain-language
summary of an already-computed diff.

## Retention: 2 most recent PER DISTINCT FILE (not 2 overall)
- Both saved spec sheets AND saved premix sheets keep the **2 most recent versions
  of EACH distinct uploaded file**, keyed by a nullable `sourceKey` column
  (normalized filename). The prune groups by `(scope, sourceKey)` and keeps
  `MAX_SAVED=2` per group. **Why:** the user has ~20 distinct spec sheets and wants
  the last 2 versions of each; a single 2-overall bucket destroyed older files on
  every new import.
- `sourceKey` derivation (`deriveSourceKey`, web `savedSpecSheets.ts`, re-exported
  by `savedPremixSheets.ts`): lowercase → strip extension → collapse whitespace →
  sort → dedupe → join `"|"`. Multi-file imports share one key. Identity is the
  UPLOADED FILENAME, threaded from the `File` objects through
  `SpecImportPrepared.sourceNames` / `PremixImportPrepared.sourceNames` into the
  commit fns. Missing/empty → `undefined` (server buckets it as the legacy `""`).
- **Legacy / keyless rows** (null sourceKey — anything saved before this, plus any
  mobile-created snapshot while parity is paused) all share the `""` bucket, so they
  behave like the OLD 2-overall rule among themselves. `latestSourceKeyIds` treats
  each null-key row as its OWN group (id-based) for the UI badge so none are hidden.
- **Newest = default:** `latestSourceKeyIds(sheets)` (shared, web) returns the ids
  that are newest within their sourceKey group; the reconcile panels badge those
  "Latest" and older ones "Previous version". Lists already sort desc(createdAt).
- `sourceKey` is OPTIONAL everywhere in the contract (additive); the DB column is
  nullable + additive (pushed via `db push-force`). Clients that omit it keep working.

## Layering (keep both apps thin)
- Pure diff lives in `@workspace/spec-reconcile`: `reconcileSpecWithRecipes` →
  discrepancy list of kinds `missing-recipe` / `missing-ingredient` /
  `extra-ingredient` / `amount-mismatch`. Match by kind+name case-insensitively;
  compare ingredient sets + lbs with tolerance. Same lib runs on server AND both
  clients. Workflow `test:spec-reconcile`.

## Profile cross-reference (die/sauce/applicators/pepperonis)
- The cross-reference also checks each sheet's brand+flavor PROFILE specs (die,
  sauce oz/pizza, applicator & pepperoni slots), not just recipe ingredient lists.
  Kept additive in `@workspace/spec-reconcile` so mobile (which imports only the
  recipe exports) still compiles. Applicator/pepperoni are compared **BY SLOT** and
  **only for spec-filled slots**; die/sauce only when the spec sets them.
- **Absence vs empty is load-bearing.** `currentProfiles` is OPTIONAL on the
  request. The server MUST skip profile reconciliation when the field is *absent*
  (older/mobile clients) — treating an omitted snapshot as `[]` makes every spec
  profile a false "missing-profile". A client with no matching profiles sends an
  explicit empty array (genuinely missing → correct). **Why:** a review caught the
  server unconditionally diffing, so absent-vs-empty must be distinguished at the route.
- **Response `discrepancies` stays recipe-only**; profile diffs live only in the AI
  `summary` text. The deterministic web panel renders profiles from its OWN
  client-side reconcile, not from the response — so don't widen the response shape.
  Because of this split, the single-sheet AI badge counts RECIPE diffs only (label
  it "recipe difference(s)"/"Recipes match", never a global "everything matches").
- **One shared prompt budget** across recipe + profile discrepancy lines (not a
  separate cap each), or a paid AI route can be pushed to ~2× the intended cap.
- **Mobile still TODO** (parity paused): send `currentProfiles` + add the Profiles
  UI. Until then it correctly gets recipe-only results. See `.local/parity-pause-log.md`.
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
