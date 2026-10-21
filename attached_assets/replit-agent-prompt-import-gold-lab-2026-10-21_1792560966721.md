# Replit Agent Prompt — Import Gold Lab

**Copy everything below the line into the Replit Agent on branch `Replit`.**

---

Branch: **Replit** only. Do not push experimental work only to `main`.

## Mission

Build **import-gold-lab**: capture **human-verified gold cases** from successful import Applies, and **score** them with optional **local OpenAI-compatible AI** (and optional Gemini) for field accuracy. Gold `expected` must never come from the model alone.

## Product rules

1. **Gold expected JSON** = final state after a **successful human Apply** (spec / premix / cheese), when the user opts in.
2. **Local AI and Gemini** only produce **candidates / scores** — never write gold expected by themselves.
3. Scorer is **read-only** against master data / inventory — no Apply, no purge, no sync writes from scoring.
4. **Soft readiness**: local AI down must **not** make `/api/readyz` fail. Record score errors and continue.
5. Do **not** enable local model on live `/ai/parse-spec-sheet`, `/ai/match-import`, or `/ai/match-premix` for all users yet — scoring path only until owner promotes later.
6. Do **not** embed OpenCode or any coding agent with shell/file tools in the app.

## Implement

### 1. Database

- Migration for:
  - `import_gold_cases` — identity PK, `scope`, `route`, `importer_type`, `input_json`, `expected_json`, `input_hash`, optional `source_label`, `difficulty` (`easy`|`hard`|`unknown`), `excluded` boolean default false, `created_by`, `created_at`
  - `import_gold_scores` — identity PK, `case_id` FK, `provider` (`gemini`|`local`|`deterministic`), `model`, `exact_match`, `field_scores` jsonb, `error`, `scored_at`
- Prefer gold cases **survive** factory purge (same policy spirit as QC history), or document export-before-purge if purge must wipe them.
- Match existing Drizzle / identity patterns on this branch.

### 2. Capture API

- `POST /api/import-gold/cases` (auth + capability, e.g. manage-factory-settings or a dedicated manage-import-gold)
- Accept after successful Apply when client sends `saveAsGold: true` (or equivalent)
- Persist:
  - `input_json`: payload shape the AI route would see (prefer server-side reconstruction from import session / last AI call if available; validate size)
  - `expected_json`: applied / final review structure
  - `route`, `importerType` (`spec`|`premix`|`cheese` etc.)
- Reject oversized bodies; strip obvious secrets if any
- `GET /api/import-gold/cases` — list (filter excluded)
- `PATCH` or equivalent to set `excluded`
- `GET /api/import-gold/export` — JSONL of non-excluded cases (admin only)

### 3. UI

- On spec / premix / cheese import review **Apply success** path: checkbox **“Save as AI gold case”** (default **off**)
- Minimal admin view: case count, list, exclude, trigger score, show last score summary (local vs gemini exact-match % if both ran)
- Unauthorized users must not see admin gold tools

### 4. Local scoring (not live import routing)

- Config: `LOCAL_AI_BASE_URL`, `LOCAL_AI_MODEL`, flag e.g. `IMPORT_GOLD_LOCAL_SCORE=1` or env present
- OpenAI-compatible client (`/v1/chat/completions` or project’s existing adapter style)
- `POST /api/import-gold/score`:
  - For each selected / all non-excluded cases:
    - Call **local** with JSON-only instructions on `input_json`
    - Zod-validate model output (best-effort map to expected shape)
    - Per-field diff vs `expected_json`
    - Store `import_gold_scores`
  - Optional: same job scores **Gemini** for comparison when configured
  - If local unreachable: store error on score row, **do not** fail process readiness
- Timeouts and max tokens bounded

### 5. Tests

- Capture creates a case row when allowed
- Unauthorized capture/score rejected
- Score with **mock** local client writes scores and field diff
- Soft behavior: mock local failure records error without throwing readiness

### 6. Docs

- Short note under `docs/evidence/` or plan pointer: gold expected = human Apply only; local used for scoring until promotion bar met; live route promotion is a separate owner decision.

## Explicitly out of scope

- Enabling local provider on production import AI routes for everyone
- Auto-Apply or auto-merge master data from scores
- OpenCode / shell agents / self-modifying app
- Vision/photo gold pipeline (text parse/match first)
- Changing SSE/outbox or identity migration unrelated to this feature

## Done when

- [ ] Migration applies cleanly
- [ ] Checkbox + POST stores input + expected from a successful Apply path
- [ ] Export returns JSONL
- [ ] Score endpoint works with mock local in tests
- [ ] Admin can see basic score summary
- [ ] `/api/readyz` still soft if local is down
- [ ] No live local routing on import AI routes unless behind an explicit unused/default-off flag documented as not promoted

Ship focused commits; match existing code style, auth, and Zod patterns on Replit.
