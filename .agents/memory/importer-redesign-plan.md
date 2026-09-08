# Importer Redesign — Plan

## Goals
1. **More accurate** — fewer AI hallucinations, silent misparses, near-duplicate recipes
2. **More automatic** — less manual review clicking, auto-apply when confident
3. **More verifiable** — stronger evidence that the import landed correctly; cell-level provenance
4. **Less AI involved** — reduce AI dependency (cost, rate limits, hallucination risk)

---

## Current Architecture

```
Excel/photo → SheetGrid[] text
  → POST /ai/parse-spec-sheet (AI parse — NO deterministic fallback for free-form)
  → server sanitize (deterministic coerce/bounds/drop)
  → client merge chunks + alias apply + ingredient links + discrepancies
  → review dialog (AI match suggestions + fuzzy fallback + second-pass AI review)
  → apply (manager-gated) → history + snapshot + audit
```

**AI is used for**: first-pass parse (spec/premix/cheese/shipping), brand/flavor match suggestions, merge suggestions, second-pass review.
**Deterministic today**: sanitization, alias application, chunk merging, ingredient link passes, discrepancy computation, corpus harness (deterministic layers only), spec-export round-trip.

**The key architectural problem**: free-form spreadsheets have NO deterministic fallback — the comment says so explicitly: "there is no usable fallback for a free-form spreadsheet." The whole pipeline depends on AI for the first pass, so AI cost, rate limits, and hallucination risk are baked in.

---

## The Redesign: Deterministic-First, AI-Fallback

```
Excel/photo → SheetGrid[] text
  → LAYER 1: Deterministic parse (structured-template detection + grid heuristics)
  → LAYER 2: Cell-level provenance tracking (every value tagged with source cell)
  → LAYER 3: Auto-match + auto-verify (confident items auto-apply, exceptions flagged)
  → LAYER 4: AI only for UNRECOGNIZED layouts (fallback, not default)
  → verify report (round-trip diff + corpus checks) → apply → history
```

### 1. Deterministic Template Parse (Layer 1 — the big de-AI win)

**Idea**: If a workbook matches a known/expected structure, parse it WITHOUT AI using cell-position rules.

**How**:
- Detection: match sheet headers/columns against expected templates (per importer type)
- Parse: deterministic cell extraction — "Doughball Weight (oz)" is at column C, rows 5-20; value at (row,subrow) reads directly
- Where templates come from: the **template download** feature (already planned in import system plan) — factories fill the expected format, so the parser can trust the structure
- Validation: column counts, required headers present, blank row rules

**Benefit**: Eliminates AI cost + hallucination for template-filled workbooks entirely. Deterministic = identical result every time.

### 2. Grid Heuristics for Semi-Structured Workbooks (Layer 1b)

Not every file matches a template, but most customer sheets have recognizable structure:
- Header keyword detection ("Brand", "Flavor", "Oz/Pizza", "Batch Lbs", "Yield")
- Sheet-boundary splitting already exists (`splitGridsSheetBoundary`)
- Known section markers ("Ingredient Order Guide", "Doughball", "Sauce")
- Number parsing with unit inference (oz vs lbs)

**Rule**: Only coordinate ambiguity/unknown layouts escalate to AI. Heuristic-confident parses skip AI.

### 3. Cell-Level Provenance (Layer 2 — the verifiability win)

**Idea**: Every parsed value carries `{ sheet, row, col, raw }` so review shows WHERE it came from.

**Current gap**: Review shows parsed values but not the source cells. You can't trace "why is this 14.2 oz?" back to the workbook.

**How**:
- Extend `ParsedSpecImport`/`ParsedProfile`/recipe rows with an optional `provenance` field
- Review UI: tap any value → highlights the source cell ("D7 on Sheet 'Bobo's Dough'")
- Diff view: each CHANGE shows old/new + source cell
- Audit: stored provenance in the import snapshot (verify "X came from cell Y")

**Benefit**: Import review becomes evidence-based. A manager can verify a number against the actual workbook cell without reopening the file.

### 4. Auto-Match + Auto-Verify (Layer 3 — the automation win)

**Idea**: Exception-based review instead of reviewing everything.

**How**:
- **Auto-apply tier**: items that match exactly (aliases, exact known-name matches, deterministic parse with 100% confidence) → auto-verified, no review click
- **Review tier**: items with ambiguity (near-dup names, first-time names, missing links) → human review
- **Auto-verify checks**: deterministic cross-field rules — "sauce lbs ≈ sauce oz/pizza × pizzas ÷ 16", "batch count = ceil(pounds / batch size)", "allergen ∈ known list"
- **Auto-apply "apply all verified"**: one click applies every auto-verified item; only flagged items remain for manual decisions

**Benefit**: A clean spec-sheet import goes from 15+ review clicks to 1 click ("Apply all verified") — or zero if everything passes.

### 5. Verification Report (Layer 5 — the audit win)

After apply, generate a structured verification report:
- **Round-trip diff**: export the applied state via `spec-export`, diff against the source workbook → "every sheet item is accounted for"
- **Corpus check**: run the parse against the corpus harness snapshots → "matches known-good baseline"
- **Reconciliation table**: source count vs. landed count vs. delta (already partially in ImportHistoryPanel)
- **Signed report**: summary hash (already exists: importReviewSignature, operational report hash contracts) → tamper-evident record

**Benefit**: Every import has a machine-checkable "this is correct" artifact, not just a human "looks good."

### 6. AI as Fallback Only (Layer 4 — the cost/safety win)

**Where AI remains** (only when deterministic layers can't resolve):
- Unrecognized free-form layouts (first parse)
- Near-dup name suggestions (still fuzzy-fallback first)
- Second-pass review of LOW-confidence items only (not every item)
- Photo-based imports (images genuinely need vision AI)

**Rate/cost controls** (already partly exist):
- Keep rate pacer + cost limits
- AI spend per import shown in review ("This import will use N AI calls ≈ $X")
- Manager toggle: "Deterministic-only mode" — blocks AI entirely, free-form files rejected with "use a template"

**Benefit**: Lower cost, fewer rate-limit pauses, smaller hallucination surface.

---

## What This Changes vs. Today

| Aspect | Today | After Redesign |
|--------|-------|----------------|
| First parse | AI-first, no fallback | Deterministic-first, AI fallback |
| Free-form CSV | AI parse | AI parse (unchanged) |
| Template file | AI parse | Deterministic parse (no AI) |
| Import review | Review everything | Auto-verify + review exceptions only |
| Verification | "Looks good" human review | Round-trip diff + corpus check + provenance |
| Traceability | Parse → apply → audit | Cell-level provenance → apply → signed report |
| AI calls per import | N (all fields) | M << N (only ambiguous/unrecognized) |
| Cost | Full AI per import | ~0 for template files |

---

## Build Order

### Phase 1: Verifiability Foundation (do first — enables everything)
1. **Cell-level provenance** — extend parsed model + review UI + snapshot
2. **Auto-verify rule engine** — deterministic cross-field checks per importer
3. **Verification report** — round-trip diff + reconciliation tables

### Phase 2: Deterministic Parse
4. **Template download** (from import plan) + canonical template definitions per importer
5. **Template detection** — structural match against expected format
6. **Deterministic cell parser** for template files
7. **Grid heuristics** for semi-structured files

### Phase 3: Automation
8. **Auto-apply tier** — confident items apply without review
9. **"Apply all verified"** — one-click bulk apply
10. **Manager "deterministic-only" mode** toggle

### Phase 4: AI Reduction
11. AI only for unrecognized layouts
12. AI spend display per import
13. Second-pass review on low-confidence items only

---

## Key Code References

| File | Purpose |
|------|---------|
| `lib/spec-import/src/index.ts` | Spec parse/sanitize (extend with provenance + deterministic layer) |
| `artifacts/run-calculator/src/specImport.ts` | Client spec prepare/review (extend) |
| `artifacts/api-server/src/routes/aiParseSpecSheet.ts` | AI parse route (make fallback-only) |
| `artifacts/run-calculator/src/parseSpecSheet.ts` | AI parse glue (rate pacer, keep) |
| `artifacts/run-calculator/src/components/SpecImportDialog.tsx` | Review UI (provenance + auto-verify tier) |
| `artifacts/run-calculator/src/components/ImportHistoryPanel.tsx` | Verification report view |
| `artifacts/run-calculator/src/importHistory.ts` | History model (extend with report) |
| `lib/corpus-harness/src/index.ts` | Deterministic regression bench (extend to template parse) |
| `lib/spec-export/src/index.ts` | Round-trip diff (verification report) |
| `lib/premix-import/src/index.ts` | Premix parser (deterministic layer) |
| `lib/cheese-import/src/index.ts` | Cheese parser (deterministic layer already) |
| `lib/shipping-import/src/index.ts` | Shipping parser (deterministic layer already) |
| `lib/name-match/src/index.ts` | Near-dup matcher (auto-match confidence) |

## New Tables / Fields
- `import_snapshots`: add `provenance` (cell-level map, JSONB)
- `import_verification_reports`: report_id, import_id, round_trip_diff (JSONB), corpus_check, signed_hash, created_at
- `imports`: add `parse_strategy` (`deterministic | heuristic | ai`), `ai_call_count`, `ai_cost_estimate`

## New / Changed Endpoints
- `POST /api/import/detect-format` — returns deterministic | heuristic | ai needed
- `POST /api/import/parse-deterministic` — template/structured parse (no AI)
- `GET /api/import/:id/verification-report` — round-trip + corpus evidence
- `POST /api/ai/parse-spec-sheet` — unchanged, now fallback path
