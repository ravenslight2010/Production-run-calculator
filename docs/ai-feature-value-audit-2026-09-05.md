# AI Feature Value Audit

**Audit date:** 2026-09-05  
**Scope:** Production Run Calculator and API Server  
**Decision standard:** Skeptical review of operational necessity, unique value, overlap, cost, risk, maintenance burden, and removal independence  
**Change status:** Phase 1 deterministic-workflow cleanup implemented. Production recap, anomaly, schedule ordering, reconciliation, expiry/use-first, incident grouping, and Run Insights no longer depend on model-written narration; compatibility fields remain where clients still read them.

## Executive decision

The product has fewer truly distinct AI jobs than its UI and route count suggest.

1. **The strongest use of AI is document extraction.** Spec-sheet spreadsheet and photo parsing can replace substantial manual transcription. It is expensive and fallible, but the source-review workflow, sanitizers, correction memory, and explicit apply boundary make it a defensible use.
2. **Cheap name resolution is useful only after deterministic resolution.** Import matching, premix matching, merge suggestions, and fill-missing overlap heavily. They should become one bounded “resolve unresolved setup data” service rather than remain separate product features.
3. **Several valuable features do not need AI at all.** Reconciliation, anomaly detection, schedule ordering, waste flags, forecast scoring, and Run Insights are deterministic. Their AI narration adds little operational value and makes reliable tools appear dependent on a model.
4. **Broad assistants have not earned their surface area.** Shift optimization, day Q&A, recipe/mix chat, production recap narration, forecast generation, and incident narration overlap with structured screens and trusted deterministic calculations.
5. **Voice commands and visual quality judgments carry disproportionate risk.** Voice classification can lead to immediate client-side mutations, while quality and label vision may be mistaken for production or release authority despite advisory labels.
6. **Shared infrastructure must not be removed with optional features.** Model routing, cost controls, bounded retries, result caching, correction aliases, memory-health repair, response sanitization, and explicit review/apply boundaries remain necessary for retained import extraction.

### Portfolio recommendation

| Recommendation | Capability count | Portfolio direction |
|---|---:|---|
| Keep | 9 | Preserve narrow extraction, non-AI import comparators, and required shared foundations. |
| Keep but simplify | 11 | Keep the useful workflow, remove model narration or unnecessary second-pass AI. |
| Consolidate | 6 | Merge overlapping resolution and memory capabilities behind shared foundations. |
| Disable/hide | 6 | Remove risky or unproven entry points first while retaining reversible code/data boundaries. |
| Retire | 10 | Remove optional AI enrichment whose job is already served by structured or deterministic product behavior. |

The 42 scored units include model-backed capabilities, deterministic features currently presented as AI, non-AI import comparators, and shared supporting capabilities. They are not route counts. A recommendation such as “disable first, then retire” is counted under **Disable/hide** because that is the next safe portfolio action.

## Scoring rubric

Every capability uses the same 1–5 scores.

| Criterion | 1 | 3 | 5 |
|---|---|---|---|
| **N — Operational necessity** | Nice-to-have | Meaningful accelerator | Required to complete an important workflow |
| **U — Unique value** | Duplicates existing UI/math | Some differentiated help | No practical non-AI substitute |
| **O — Overlap burden** | Little overlap | Partial duplication | Same job is already served elsewhere |
| **C — Cost burden** | No/rare cheap calls | Regular cheap or bounded full calls | Vision, large context, second pass, or repeated full calls |
| **R — Risk burden** | Read-only, deterministic, easily verified | Advisory judgment with review | Can misdirect operations, mutate state, or resemble safety/release authority |
| **M — Maintenance burden** | Small isolated adapter | Client/server/schema/fallback coverage | Cross-platform, prompt, persistence, review, and many integration boundaries |
| **I — Removal independence** | Deeply foundational | Some shared dependencies | Can be removed while leaving valuable foundations intact |

High N and U favor retention. High O, C, R, M, and I favor simplification or retirement. Scores are architectural and operational judgments from the current implementation; they are not usage telemetry.

## Complete capability inventory and recommendations

### A. Core assistant and production planning

| Capability | Entry point and API behavior | Model / access / persistence | Dependencies and non-AI alternative | Scores N/U/O/C/R/M/I | Recommendation and evidence |
|---|---|---|---|---|---|
| **Shift optimization** | Management Assistant, “Analyze shift”; `POST /ai/optimize`; returns run, break, and efficiency recommendations with optional apply actions. | Full model; `use-ai-tools`; cached result; advisory reviewer may add verdicts; no server-side apply. | Uses the same shaped run facts and calculations already visible in live run, schedule, and history screens. Client applies through existing handlers. | 2/2/5/4/4/4/5 | **Retire.** It recombines already-visible operational facts into broad advice, can propose state-changing actions, and requires a large prompt plus review. Preserve the deterministic run-shaping utilities used elsewhere. |
| **Ask about the day** | Assistant chat; `POST /ai/ask`, including SSE streaming; answers free-form questions about current and historical runs. | Full model; all authenticated staff; per-user conversation history persists. | Structured live-run status, schedule, recap statistics, alerts, and history answer the supported questions more reliably. | 2/2/5/4/3/4/5 | **Retire.** Open-ended Q&A has broad prompt and memory surface but no unique operational authority. Keep structured summaries and calculations. |
| **Voice input and answer narration** | Microphone and speaker controls inside Ask and Recipe Assistant; browser speech recognition/synthesis. | Browser speech APIs plus AI command/ask/recipe routes; all authenticated staff; conversation may persist. | Typing, buttons, and on-screen responses remain complete alternatives. | 1/2/5/2/3/4/5 | **Retire.** Accessibility value is plausible but unproven here; it doubles interaction states and cross-browser failure modes without being required to operate the calculator. |
| **Voice command classification** | Spoken phrase calls `POST /ai/command`; cheap model classifies question, command, or none; client dispatches returned actions immediately with a short Undo window. | Cheap model; all authenticated staff; endpoint itself is read-only, but the client may mutate current state through existing handlers. | Existing explicit controls are safer, visible, permission-aware, and auditable. | 1/2/5/2/5/5/4 | **Disable/hide first, then retire.** Classification error can become an immediate write. A short Undo is weaker than confirmation-before-apply. Preserve `@workspace/voice-commands` only until all callers are removed. |
| **Recipe/formula assistant** | Assistant chat; `POST /ai/recipe-assistant`, streaming or JSON; may return an apply-able field suggestion. | Full model; all authenticated staff; current recipe, known ingredients, memory, and corrections ground the prompt; client confirmation/Undo controls writes. | Setup editors, saved recipes, spec reconciliation, fill-missing, and deterministic validation cover the supported job. | 2/2/5/4/4/5/5 | **Retire.** A broad recipe chat duplicates focused setup workflows and expands the risk of plausible but wrong production formulas. Preserve shared recipe-apply validation for non-chat workflows. |
| **Mix assistant** | Mixes area / `MixAssistChat`; `POST /ai/mix-assistant`; plain-language help over mix definitions. | Full model; all authenticated staff; memory-grounded; advisory. | Mix editor, deterministic batch math, import review, and mix reconcile provide structured answers. | 1/2/5/4/3/4/5 | **Retire.** It is another broad chat over a domain that already has deterministic calculations and dedicated review screens. |
| **Production recap narration** | Assistant “Production Recap”; `POST /ai/summary`; day/week summary. | Full model only when data exists; all authenticated staff; result cache; no writes. | `@workspace/day-summary` computes all statistics and already builds a deterministic fallback. | 3/1/5/3/2/3/5 | **Keep but simplify.** Keep the deterministic recap and statistics; remove model narration and present the fallback as the normal feature. |
| **Anomaly narration** | Assistant “Anomaly Check”; `POST /ai/anomalies`; model narrates only when deterministic anomalies exist. | Full model; all authenticated staff; read-only; no call when history is insufficient or no anomaly exists. | `@workspace/anomaly` produces the actual anomaly list, counts, baselines, descriptions, and severities. | 4/1/5/2/2/3/5 | **Keep but simplify.** Keep deterministic detection; retire narration. The facts, not prose, are the operational value. |
| **Schedule optimization narration** | Assistant “Schedule Optimizer”; `POST /ai/schedule-optimize`; manager explicitly applies suggested order with Undo. | Full model only for an improved order; `use-ai-tools`; read-only server response. | `@workspace/schedule-optimize` deterministically honors allergen order, production rules, and changeover grouping. | 4/1/5/2/3/4/5 | **Keep but simplify.** Keep deterministic ordering and explicit apply/Undo; remove narration and stop presenting the calculation as an AI dependency. |
| **Demand forecast generation** | Assistant “Demand Forecast”; `POST /ai/forecast`; predicts 1, 3, or 7 days and opens suggestions in the editable schedule. | Full model; `use-ai-tools`; forecast facts persist in facility memory; cached; deterministic verification/fallback boundaries. | Managers can copy/edit prior schedules and use history. The app lacks an authoritative demand signal such as orders or sales. | 2/2/4/5/5/5/4 | **Disable/hide.** Production history alone is weak demand evidence; confident-looking case quantities can cause material or labor errors. Preserve stored plans temporarily for cleanup and accuracy review. |
| **Forecast accuracy review** | Assistant “Forecast Accuracy”; `POST /ai/forecast-accuracy`; deterministic scoring against completed runs. | No model; `use-ai-tools`; writes accuracy facts to the shared facility-memory table. | Useful only as a control for the forecast generator. It has no independent planning function. | 2/2/4/1/2/3/3 | **Retire after forecast data retention is resolved.** It is good governance for an unproven feature, not a reason to keep that feature. Export or retain historical records only if product review requires them. |
| **Proactive alert generation** | Global proactive banner from `useProactiveAlert`; `POST /ai/proactive-alert`; settings also appear in inventory. | Full model after deterministic gates; `use-ai-tools`; per-user settings and dismissal knowledge persist. | Existing low-stock, expiry, schedule, behind-pace, run-completion, and manager-attention alerts already identify actionable states. | 2/1/5/4/4/5/4 | **Consolidate.** Move any unique deterministic trigger into the existing alert system; retire generated alert prose, AI polling, and AI-specific dismissal memory. |
| **Proactive alert settings** | `GET/PUT /ai/proactive-settings`; toggles AI watcher behavior. | No model; read open to authenticated users, write requires `use-ai-tools`; persisted. | Standard alert preferences already provide the right product-level settings home. | 1/1/5/1/1/2/5 | **Retire with proactive AI.** Migrate any still-useful toggle to normal notification preferences only if a deterministic trigger survives. |

### B. Setup, import, matching, and reconciliation

| Capability | Entry point and API behavior | Model / access / persistence | Dependencies and non-AI alternative | Scores N/U/O/C/R/M/I | Recommendation and evidence |
|---|---|---|---|---|---|
| **Spec workbook parsing** | Spec import dialogs; `POST /ai/parse-spec-sheet`; parses workbook chunks into profiles and dough/sauce/cheese/mix recipes for review. | Full model with large structured-output allowance; `use-ai-tools`; bounded retry, sanitization, reviewer verdicts, corrections/memory grounding; imported source snapshots and explicit apply persist separately. | Manual setup entry is possible but costly. Deterministic code handles chunking, post-parse canonicalization, linking, source snapshots, review, and final writes. | 5/5/1/5/4/5/2 | **Keep.** This is the clearest labor-saving AI workflow. Keep source evidence, per-item review, fail-closed parsing, corpus tests, and explicit apply. Do not automatically protect its second AI reviewer; evaluate that separately. |
| **Spec photo transcription** | Multi-photo spec import; `POST /ai/parse-spec-images`; transcribes pages to bounded workbook-like text, then reuses the workbook parse/review path. | Full vision model; `use-ai-tools`; no direct writes. | Manual transcription or a real workbook upload. Reuse of the existing parser limits downstream complexity. | 3/4/2/5/4/4/4 | **Keep but simplify.** Keep as an alternate input adapter, not a separate import intelligence system. Preserve the single canonical workbook parsing and review pipeline. |
| **Schedule workbook name matching** | Schedule Excel import review; `POST /ai/match-import`; fills only unresolved brand, flavor, ingredient, applicator, and pepperoni matches. | Cheap model; `use-ai-tools`; deterministic resolution and learned aliases run first; result cache and reviewer; confirmed aliases persist. | Exact/loose matching, known aliases, and manual dropdowns already handle most cases. | 4/3/4/2/4/5/3 | **Consolidate.** Keep AI only for unresolved names behind a shared resolver. Never auto-apply over a user or alias choice; preserve canonicalization and confirmation. |
| **Premix name matching** | Premix import review; `POST /ai/match-premix`; resolves unmatched imported product names. | Cheap model; `use-ai-tools`; deterministic resolution first; cache, reviewer, correction grounding; confirmed redirect aliases persist. | Exact/loose matching and manual brand/flavor selection. | 3/3/4/2/4/4/4 | **Consolidate.** Use the same unresolved-name service and evidence contract as schedule import instead of a standalone model feature. |
| **Merge suggestions** | Setup/master-data merge scans; `POST /ai/suggest-merges`; proposes duplicate names for human review. | Cheap model; `use-ai-tools`; cache, corrections, denied-pair memory, learned aliases, and reviewer verdicts; merge happens only through normal confirmed paths. | Shared deterministic layered matcher already finds exact, loose, and near duplicates. | 3/2/5/3/5/5/3 | **Consolidate.** Keep deterministic candidates primary. Route only ambiguous leftovers through the common resolver; preserve deny history, tombstones, target-survival checks, counts, and explicit merge confirmation. |
| **Fill missing setup fields** | Setup “Fill Missing” panel; `POST /ai/fill-missing`; suggests values only for fields not resolved by higher-priority sources. | Cheap model; `use-ai-tools`; learned/profile/spec/default resolution is deterministic; AI is last; second-pass reviewer; user applies individual suggestions. | The source-priority pipeline already fills most values. Manual setup remains available. | 3/3/3/2/4/5/3 | **Keep but simplify.** Retain the source-priority workflow and a bounded last-resort resolver. Consolidate its model call with unresolved setup resolution and remove redundant reviewer calls where deterministic validation plus human confirmation is sufficient. |
| **Spec reconciliation narration** | Management import review / `SpecReconcilePanel`; “Cross-reference all” is local, while per-sheet “AI summary” calls `POST /ai/spec-reconcile`. | Full model; authenticated user; cache; read-only. | `@workspace/spec-reconcile` owns the complete deterministic diff and exact discrepancy list. | 4/1/5/3/2/3/5 | **Keep but simplify.** Keep deterministic cross-reference and remove the optional AI-written summary. |
| **Mix reconciliation narration** | Mix review / `MixReconcilePanel`; `POST /ai/mix-reconcile`. | Full model; authenticated user; cache; read-only. | Deterministic mix reconciliation owns the differences; AI only summarizes. | 3/1/5/3/2/3/5 | **Keep but simplify.** Keep deterministic discrepancy output and remove narration. |
| **Cheese import** | Cheese workbook dialog parses and reviews cheese recipes. | No dedicated model route in the current server inventory; deterministic parser and normal import review. | Already the preferred posture: structured parsing, matching, and explicit review without model dependency. | 4/3/1/1/2/3/2 | **Keep.** Do not classify it as a removable AI feature merely because UI comments call parsing “AI.” Preserve the deterministic implementation. |
| **Shipping-guide import** | Shipping settings import and targeted profile merge. | Deterministic; no model route. | Direct structured parser is the implementation. | 4/4/1/1/2/3/2 | **Keep.** This is a useful non-AI comparator for deciding when deterministic parsing is sufficient. |

### C. Inventory, camera, quality, and waste

| Capability | Entry point and API behavior | Model / access / persistence | Dependencies and non-AI alternative | Scores N/U/O/C/R/M/I | Recommendation and evidence |
|---|---|---|---|---|---|
| **Photo stock intake** | Inventory “Photo Intake”; `POST /inventory/identify-photo`; extracts one or more item names, quantities, units, lots, and dates into a review table. | Full vision model; `use-ai-tools`; learned photo aliases persist; inventory writes occur only after review through normal inventory APIs. | Barcode scanner, typed restock, count card, known item catalog, and deterministic candidate ranking. | 3/4/3/5/4/5/4 | **Keep but simplify.** This can save transcription time for multi-item intake, but it should remain a draft extractor. Keep manual/barcode paths primary and require row-level confirmation. |
| **Count from photos** | Inventory “Count from photos”; `POST /inventory/count-observations` creates a persisted draft from one to three photos. Manager review can call `POST /inventory/count-observations/:id/apply`, transactionally creating an item if needed, a lot, a restock ledger entry, and a product reference; cancel closes the draft without inventory effects. | Full vision model; `manage-inventory`; sanitized field evidence/confidence and review flags persist in `inventoryObservations`; explicit manager Apply is the write boundary. The analysis route is request-rate-limited but does not use the AI router’s shared cost-limit middleware. | Manual count/restock, barcode scanning, typed lots, and Photo Intake overlap. Quantity estimation from a shelf or pallet view is not calibrated. | 2/3/4/5/5/5/4 | **Disable/hide.** A plausible quantity estimate can become inventory truth after one review action and then affect coverage and consumption. Preserve open drafts and applied ledger history; do not delete inventory records when disabling the camera entry point. |
| **Visual quality assessment** | Inventory “Quality Check”; `POST /inventory/quality-photo`; model returns pass/warn/fail, confidence, and issues; user may confirm to quality history and facility memory. | Full vision model; `use-ai-tools`; confirmed result and optional thumbnail persist; future prompts consume bounded quality facts. | Human quality inspection and structured quality checklist/history. | 1/2/3/5/5/5/5 | **Disable/hide.** The model has no calibrated plant-specific inspection standard and its output can look like release authority. Preserve confirmed quality-history records and build any future tool around a human checklist, not an AI verdict. |
| **Paper production-sheet transcription** | Inventory “Read Run Sheet”; `POST /inventory/production-sheet-photo`; returns draft run rows; no write. | Full vision model; `use-ai-tools`; read-only. | Manual schedule entry and spec-photo transcription infrastructure overlap substantially. | 2/3/4/5/4/4/5 | **Consolidate.** If retained, use the same generic reviewed-document extraction adapter as spec photos. Otherwise retire this entry point before the shared vision adapter. |
| **Label/pallet verification** | Inventory “Verify Label”; `POST /inventory/label-verify`; reads expected fields and server recomputes match/mismatch/unreadable. | Full vision model; `use-ai-tools`; read-only; no record. | Barcode scanning, direct human comparison, and dedicated industrial vision/verification systems are safer alternatives. | 2/3/3/5/5/5/5 | **Disable/hide.** A generic vision model should not be mistaken for an official label or lot-control check. Retention would require a validated operating protocol and explicit non-release boundary. |
| **Waste insight narration** | Inventory “Waste Insight”; `POST /inventory/waste-insight`; flags expired/expiring lots and suggests actions/run priority. | Full model only when deterministic risk exists; `use-ai-tools`; may write bounded dismissal/knowledge facts; no inventory mutation. | Inventory already displays expiry, low-stock, transfer, coverage, and use-first information. Deterministic expiry flagging is complete. | 3/1/5/3/3/4/5 | **Retire.** Keep deterministic expiry/soon flags and use-first ordering; remove generated advice and memory writes. |

### D. Incidents and continuous improvement

| Capability | Entry point and API behavior | Model / access / persistence | Dependencies and non-AI alternative | Scores N/U/O/C/R/M/I | Recommendation and evidence |
|---|---|---|---|---|---|
| **Incident diagnosis and workaround** | User issue report; incident creation calls a full model and persists diagnosis/workaround with the incident. | Full model; any authenticated user may report; managers need `review-incidents` to inspect/work; deterministic fallback text; history-aware facility memory. | Incident description, crash context, recurrence, assignment, notes, workflow state, and human diagnosis already form a complete incident workflow. | 2/2/4/4/5/5/4 | **Disable/hide generated diagnosis, then retire.** Persisted hypotheses can anchor reviewers on a plausible but false cause. Keep incident capture, recurrence, assignment, and human notes. Preserve existing records as unverified historical text until a data-retention decision is made. |
| **Incident clustering** | Incidents “Find patterns”; `POST /ai/incident-clusters`; groups recurring reports into themes, hypotheses, and actions. | Full model; `review-incidents`; read-only; deterministic/computed grouping fallback is available. | Recurrence metadata, filters, workflow fields, and deterministic grouping can expose frequency without invented root causes. | 2/2/4/4/4/4/5 | **Keep but simplify.** Keep computed grouping/counts; retire AI root-cause hypotheses and recommended actions. |
| **Run Insights pattern detection** | Setup “Run Insights”; staff observations feed `/run-suggestions/observe`; managers accept/dismiss via `/run-suggestions/update`; follow-up via `/run-suggestions/follow-up`. | Detection is client-side deterministic; cheap model only narrates; scoped suggestion, status, suppression, and follow-up persist; acceptance requires `use-ai-tools` and client applies the setting. | Deterministic threshold logic, stats line, configured/observed/recommended values, Accept/Dismiss, and follow-up already provide the whole decision. | 4/2/3/2/4/5/4 | **Keep but simplify.** Keep deterministic detection, persistence, suppression, explicit manager acceptance, and follow-up. Remove cheap narration and show the deterministic stats line. |

### E. Shared AI foundations

| Capability | Current role | Scores N/U/O/C/R/M/I | Recommendation and boundary |
|---|---|---|---|
| **Model routing** | `pickModel("cheap"|"full")` centralizes provider/model selection for all model calls. | 5/5/1/1/2/2/1 | **Keep** while any AI remains. No route should select a model independently. |
| **Cost and request limiting** | Per-operation limits, production-shared stores, cost accounting, and friendly 429 behavior bound paid usage. | 5/5/1/1/2/4/1 | **Keep.** Retained full/vision import calls make this mandatory. Delete only counters for retired operations after callers are gone. |
| **Bounded JSON retry and response sanitization** | Retries malformed JSON/provider 429 once; route-specific validation canonicalizes output to known fields/options. | 5/5/1/2/2/4/1 | **Keep.** This is safety infrastructure for document extraction and unresolved-name resolution. |
| **AI result cache and in-flight deduplication** | Prompt/model fingerprinted DB cache with TTL, size/row bounds, and failure-not-cached behavior. | 4/4/1/1/2/4/2 | **Keep.** Narrow namespaces to retained operations during cleanup; do not remove the shared cache before import benchmarks confirm acceptable cost and latency without it. |
| **Second-pass AI reviewer** | A full-model advisory pass labels model suggestions `ok`, `warn`, or `reject`; failure leaves original suggestions unchanged. | 2/2/4/5/3/5/4 | **Retire or sharply narrow.** It can double cost and cannot make first-model output authoritative. For imports, rely on deterministic sanitizers, source evidence, and mandatory human review; retain only if benchmarked against the real corpus and shown to catch errors not caught elsewhere. |
| **Correction and alias memory** | Confirmed name equivalences, denied pairs, canonical aliases, and correction context improve future imports/matches. Health tooling supports scoped audit, delete, and retarget repair. | 5/5/1/1/3/5/1 | **Keep.** This is durable operational learning, not chat memory. It is shared by retained import parsing and matching. Preserve strict domains, scoping, cycle/poison guards, and manager repair tools. |
| **Facility knowledge** | Stores bounded facts for quality, forecast, proactive alerts, incidents, ingredients, and general grounding. | 2/2/4/2/4/5/3 | **Consolidate.** Retain only domains with a surviving, verified consumer. Remove quality/forecast/proactive/incident-generated facts in a separate data-safe cleanup; do not mix them with correction aliases. |
| **Conversation memory** | Per-user bounded chat turns support Ask follow-ups. | 1/2/5/1/3/3/5 | **Retire with Ask.** Delete or expire turns under an explicit retention plan; do not remove facility corrections with them. |
| **Memory context and privilege filtering** | Builds scoped context, separates privileged facility domains from staff-facing routes, and fails empty on DB errors. | 4/4/1/1/3/4/2 | **Keep but simplify.** Preserve correction grounding and privilege filters for retained routes; remove dead domains and conversation assembly after dependent features retire. |
| **AI status contract** | Distinguishes deterministic, enriched, cached, unavailable, and unknown responses in generated contracts and UI notices. | 3/4/1/1/1/3/2 | **Keep.** It remains valuable while deterministic-first endpoints and optional enrichment coexist; simplify after narration routes are removed. |

## Dependency map

### Foundations that must remain for retained workflows

- **Spec import:** model routing, full-model access, cost limiting, JSON retry, prompt/input bounds, sanitization, source snapshots, correction grounding, explicit review/apply, corpus tests.
- **Spec photo input:** shared image compression/size guards, full vision access, retry, transcription bounds, then the same canonical spec pipeline.
- **Unresolved-name resolution:** cheap-model routing, deterministic-first matching, correction aliases, result cache, canonical allowlists, reviewer-visible evidence, deny memory, explicit confirmation.
- **Photo stock intake:** shared image handling, candidate catalog, photo aliases, row-level review, and normal inventory mutation APIs.
- **Deterministic operations:** anomaly, schedule optimization, recap, reconciliation, expiry flags, incident recurrence/group counts, run-suggestion math, and forecast scoring do not require model infrastructure.

### Couplings that should be broken during cleanup

- `AssistantTab` currently bundles staff Q&A/recipe chat with manager schedule, forecast, accuracy, and optimization. Removal should be per capability, not a wholesale deletion of the deferred management surface, because import review lives beside it.
- AI memory combines distinct concepts: user conversation, confirmed aliases/corrections, and generated facility facts. They require separate retention decisions.
- Several deterministic endpoints return `aiStatus` and optional prose. Remove prose first, then rename or relocate the deterministic feature only after client/server contracts are stable.
- Run Insights is routed and labeled near AI but its decision logic is deterministic. Removing `runSuggestions.ts` would incorrectly discard a useful feedback loop just to remove cheap narration.
- Vision utilities are shared. Disable risky quality/label entry points without deleting the image-size, compression, and retry foundations needed by spec-photo and stock-intake extraction.
- Inventory vision does not have one uniform cost-control boundary. The retained `/inventory/identify-photo` path and the currently recommended-for-disable `/inventory/count-observations` path have request-rate limits, but they do not run the shared AI-router cost-limit middleware. Treat cost enforcement for any retained inventory vision as an explicit follow-up, not as existing coverage.
- The advisory reviewer is shared by high-value imports and low-value assistants. Remove or narrow it only after comparing deterministic validation plus human review against the retained corpus.

## Prioritized retirement shortlist

| Priority | Candidate | Expected complexity | User impact | Dependencies that remain |
|---:|---|---|---|---|
| 1 | Waste Insight model narration | Low | Expiry and low-stock facts remain; only generated advice disappears. | Deterministic expiry/use-first logic, inventory alerts |
| 2 | Recap, anomaly, schedule, spec-reconcile, mix-reconcile, Run Insights narration | Medium | Facts and actions remain; labels become clearer and responses faster/cheaper. | All deterministic libraries, route contracts during transition, Run Insights persistence |
| 3 | Voice input/output and `/ai/command` | Medium | Users use explicit buttons and typed input during Ask/recipe transition. | Existing mutation handlers; shared voice library only until callers are removed |
| 4 | Quality-photo and label-verification entry points | Medium | Removes unvalidated visual judgments; manual quality and label checks remain. | Quality history, inventory APIs, shared vision adapter for retained extraction |
| 5 | Count-from-photos entry point | Medium | Manual counts and restocks remain; open drafts and applied ledger history are retained. | Inventory observations/history, lots, ledger, product references, normal inventory APIs |
| 6 | Shift optimization, Ask chat, recipe assistant, and mix assistant | High | Removes broad assistant surfaces; structured run/setup screens remain. | Recipe-apply validation, optimize input shaping only where still consumed, corrections |
| 7 | Proactive AI alert and its dedicated settings/memory | High | Existing operational alerts remain; any unique deterministic trigger must move first. | Normal alert preferences, deterministic stock/pace/attention checks |
| 8 | Demand forecast, forecast accuracy, and forecast facts | High | Managers plan from schedules/history without model-generated demand. | Schedule editor, history, safe retention/migration for existing forecast facts |
| 9 | Incident diagnosis prose and AI root-cause hypotheses | High | Incident capture, recurrence, assignment, status, and human notes remain. | Incident tables/workflow, deterministic grouping, existing records pending retention decision |
| 10 | Second-pass AI reviewer | Medium–High | Review badges may disappear; source evidence and human confirmation remain. | Deterministic sanitizers, corpus harness, corrections, normal review UI |
| 11 | Separate match/fill/merge model routes | High | No capability loss if replaced by one unresolved-data resolver. | Deterministic-first matchers, aliases, canonicalization, explicit review/apply |

## Safe phased cleanup order

### Phase 0 — Approval and evidence boundary

1. Review this audit with operations/product owners.
2. Confirm which recommendations are accepted; this audit intentionally did not change behavior.
3. Decide retention for conversation turns, forecast facts, generated incident diagnoses, confirmed quality records, thumbnails, and facility-knowledge domains.
4. Define one acceptance benchmark for retained extraction using the real workbook/photo corpus and review corrections, not feature-click telemetry.

### Phase 1 — Remove model-only narration

1. Make deterministic recap, anomaly, schedule order, reconciliation, expiry, incident grouping, and Run Insights text the normal responses.
2. Remove corresponding model calls, reviewer passes, memory writes, cache namespaces, and AI status copy only after clients no longer depend on them.
3. Keep endpoint shapes compatible during the transition where cross-version clients may exist.

This phase has the best savings-to-risk ratio because the operational result already exists without AI.

### Phase 2 — Disable risky optional inputs

1. Hide voice controls and stop calling `/ai/command`.
2. Hide count-from-photos, visual quality, and label-verification cards.
3. Preserve manual quality history, label procedures, and shared vision utilities.
4. Stop new generated memory writes before deleting old data.

### Phase 3 — Retire broad assistants and experiments

1. Remove shift optimization, Ask, recipe chat, and mix chat UI independently.
2. Remove per-user conversation persistence after the approved retention window.
3. Move any reusable deterministic calculation or recipe-apply validation out of assistant-specific modules before deleting them.
4. Disable forecast generation, then retire accuracy review after resolving historical facts.
5. Fold any unique proactive trigger into normal alerts before removing AI watcher settings and memory.

### Phase 4 — Consolidate retained AI

1. Keep one document-extraction foundation with adapters for workbook text, spec photos, and—only if approved—paper run sheets or stock intake.
2. Keep one deterministic-first unresolved-data resolver for import matching, premix matching, fill-missing, and merge candidates.
3. Keep correction/alias memory separate from generated facility facts and conversation history.
4. Evaluate the reviewer with corpus evidence; remove it unless it measurably catches otherwise-unhandled errors.
5. Delete dead route schemas, prompts, tests, cache namespaces, rate-limit counters, UI notices, and facility domains only after callers and persisted-data obligations are gone.

## Completeness review

### User-facing entry points checked

- Management Assistant: Ask, speech input/output, voice commands, recipe assistant, production recap, anomaly check, schedule optimizer, demand forecast, forecast accuracy, and shift analysis.
- Mix assistant.
- Setup/import: spec workbook, spec photos, schedule Excel matching, premix matching, fill missing, merge suggestions, spec reconcile, mix reconcile, cheese import, and shipping-guide import.
- Inventory: photo stock intake, count-from-photos persisted drafts/apply/cancel, quality photo, production-sheet photo, label verification, waste insight, proactive alert settings, and the existing deterministic inventory alerts.
- Incidents: generated diagnosis/workaround and incident clustering.
- Setup Run Insights and its observe/accept/dismiss/follow-up loop.
- Global proactive alert banner.

### Backend/support capabilities checked

- All 21 routes under the AI router:
  - `/ai/optimize`
  - `/ai/ask`
  - `/ai/command`
  - `/ai/recipe-assistant`
  - `/ai/spec-reconcile`
  - `/ai/mix-reconcile`
  - `/ai/mix-assistant`
  - `/ai/proactive-alert`
  - `GET/PUT /ai/proactive-settings`
  - `/ai/forecast`
  - `/ai/summary`
  - `/ai/anomalies`
  - `/ai/schedule-optimize`
  - `/ai/forecast-accuracy`
  - `/ai/fill-missing`
  - `/ai/match-import`
  - `/ai/parse-spec-sheet`
  - `/ai/parse-spec-images`
  - `/ai/match-premix`
  - `/ai/suggest-merges`
- Inventory AI routes: `/inventory/identify-photo`, `/inventory/count-observations` plus draft get/list/apply/cancel paths, `/inventory/quality-photo`, `/inventory/production-sheet-photo`, `/inventory/label-verify`, and `/inventory/waste-insight`.
- Incident AI paths: incident creation diagnosis and `/ai/incident-clusters`.
- Run-suggestion narration plus deterministic observation, persistence, manager decision, and follow-up paths.
- Model routing, retry, cache/deduplication, cost/rate limiting, reviewer, memory context, facility knowledge, conversation memory, corrections, correction-health repair, and AI status contracts.

### Consistency checks

- No recommendation removes a deterministic system merely because it is exposed through an AI-labeled screen.
- No recommendation removes correction aliases, sanitization, cost controls, retry, caching, source evidence, or explicit review boundaries required by retained import extraction.
- Risky capabilities are disabled before shared infrastructure or historical data is deleted.
- Persistent data gets a separate retention/migration decision; retirement is not treated as permission to purge it.
- Established import parsing and matching were scored under the same burden-of-proof standard as optional assistants.
- No production behavior was changed as part of this audit.

## Source map

Primary implementation evidence:

- `artifacts/run-calculator/src/components/AssistantTab.tsx`
- `artifacts/run-calculator/src/components/DeferredManagementAiSurface.tsx`
- `artifacts/run-calculator/src/components/InventoryTab.tsx`
- `artifacts/run-calculator/src/components/PhotoCountCard.tsx`
- `artifacts/run-calculator/src/components/IncidentsTab.tsx`
- `artifacts/run-calculator/src/components/RunInsightsCard.tsx`
- `artifacts/run-calculator/src/components/SpecReconcilePanel.tsx`
- `artifacts/run-calculator/src/components/MixReconcilePanel.tsx`
- `artifacts/run-calculator/src/components/ExcelImportDialog.tsx`
- `artifacts/run-calculator/src/components/SpecImportDialog.tsx`
- `artifacts/run-calculator/src/components/PremixImportDialog.tsx`
- `artifacts/run-calculator/src/components/CheeseImportDialog.tsx`
- `artifacts/run-calculator/src/pages/home.tsx`
- `artifacts/run-calculator/src/aiAsk.ts`
- `artifacts/run-calculator/src/aiCommand.ts`
- `artifacts/run-calculator/src/aiOptimize.ts`
- `artifacts/run-calculator/src/aiRecipe.ts`
- `artifacts/run-calculator/src/aiForecast.ts`
- `artifacts/run-calculator/src/aiSummary.ts`
- `artifacts/run-calculator/src/aiAnomaly.ts`
- `artifacts/run-calculator/src/aiSchedule.ts`
- `artifacts/run-calculator/src/aiProactive.ts`
- `artifacts/run-calculator/src/inventoryShared.ts`
- `artifacts/run-calculator/src/mergeSuggest.ts`
- `artifacts/run-calculator/src/matchImport.ts`
- `artifacts/api-server/src/routes/ai.ts`
- `artifacts/api-server/src/routes/aiReviewer.ts`
- `artifacts/api-server/src/routes/aiMemory.ts`
- `artifacts/api-server/src/routes/aiMemoryContext.ts`
- `artifacts/api-server/src/routes/aiMemoryHealth.ts`
- `artifacts/api-server/src/routes/aiCorrections.ts`
- `artifacts/api-server/src/routes/inventory.ts`
- `artifacts/api-server/src/routes/countObservation.ts`
- `artifacts/api-server/src/routes/incidents.ts`
- `artifacts/api-server/src/routes/runSuggestions.ts`
- `artifacts/api-server/src/lib/aiResultCache.ts`
- `artifacts/api-server/src/lib/aiJsonRetry.ts`
- `artifacts/api-server/src/lib/rateLimitCost.ts`
- `lib/voice-commands/src/index.ts`
- `lib/recipe-apply/src/index.ts`
