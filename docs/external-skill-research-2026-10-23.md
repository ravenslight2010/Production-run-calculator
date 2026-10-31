# External skill adoption research

Research date: 2026-10-23. Repository baseline:
`0cdb38f5ee8d9332768fa9640efda36f747b6a3b`.
Owner: Replit Agent. Scope: read-only discovery and recommendation; no installation.

## Coverage matrix established before candidate selection

The prior [coverage audit](../.local/tasks/improve-app-skill-coverage.md) improved
internal routing; this investigation evaluates external material, not a repeat
audit or authority to implement historical recommendations.

| Workstream | Current authoritative guidance | Verified need / future boundary | External research route |
|---|---|---|---|
| Sync, offline recovery, multi-device state | `sync-invariant-check`, `operational-browser-verification`, `error-handling` | Adequately covered. Preserve server authority, epoch/snapshot fencing, scope, wake-before-publish and queued intent identity. Server authority/undo work has existing owners. | Compare PWA/offline skills; reject generic replay/reload policies. |
| Production math and every station | `state-accuracy-check`, `wrong-number-triage`, `property-based-testing`, `test-gap-triage` | Covered operationally; investigate a reusable dimensional-analysis method, not new production formulas. Dough/Press, Sauce/Frontline, applicators/mixes, Packaging, Freezer/Tunnel and Warehouse do not have interchangeable counters. | Trail of Bits numeric auditing and stateful/property tests. |
| Workbook import/export and data repair | `import-bug-investigation`, `spec-import-guard`, `customer-import-audit`, `data-heal-playbook`, `data-cleanup` | Adequately covered. Preserve units, formulas vs cached values, source ownership, review/Apply, retained evidence and stale-client fences. | Original spreadsheet skills versus current corpus/pipeline. |
| PostgreSQL, Drizzle, schema | `drizzle-best-practices`, `db-schema-change`, `schema-change-checklist` | Query/schema safety covered; investigate bounded query-plan, lock and connection-performance reference material. Do not replace the adapted Drizzle skill. | Supabase PostgreSQL guidance, not Supabase platform migration. |
| Browser/PWA/accessibility/responsive | `operational-browser-verification`, platform `testing`, `react-vite`, `error-handling`; a11y/browser memory | Existing journey ownership is adequate; investigate false-green assertion review and static accessibility review. Phone/tablet repair already has an owner. | Deferred three browser candidates, Microsoft upstream, Web Quality Skills. |
| Security/privacy/operational diagnostics | `ci-security-review`, `evidence-hygiene`, `api-design`, `error-handling`, platform `security-scan`, `deployment`, `site-reliability-engineer` | Covered; investigate only incremental differential-review guidance. Existing safety gates cannot be replaced by external automation. | Trail of Bits originals; exclude bulk offensive toolkits/installers. |
| QC/allergen | Approved Phase 1 decisions, `api-design`, `error-handling`, schema and browser specialists | Domain policy is not an external-skill gap. Current source includes component/label/date/Brix handlers; the older Phase 2 proposal is not a current backlog. Intelligence reports and Brix source follow-ons have owners. | Search food-specific skills; no inferred targets, holds, label claims or regulatory authority. |
| Local AI evaluation | `skill-creator`, `evidence-hygiene`, local evaluator docs and deterministic evaluation libraries | Covered bounded synthetic/offline evaluation. Distinguish runtime adapter support from authorization to change the production provider. | Hugging Face evaluation/local-model skills; no remote uploads/training/GPU assumption. |
| Planned app decomposition | `react-vite`, `test-gap-triage`, state/sync/API specialists; approved decomposition roadmap | Selective internal extraction only. Existing deferred graph evidence is not a measured startup speedup. Investigate composition review, not new apps/services/stores. | Vercel composition and React guidance with Vite/version/provider filtering. |

## Consolidated recommendation

**Do not bulk-install another bundle.** Keep the existing domain skills. If the
owner approves adoption, first pilot the small, static false-green test review
adaptation; then a bounded unit-analysis guide and PostgreSQL performance
references. Accessibility is useful but lower priority. None is installed here.

Ranking is an engineering judgment, not a measured model-quality result.
Benefit/frequency/risk-reduction use 1–5 (higher is better); effort and ongoing
maintenance use small/medium/large. Risk reduction refers to the proposed bounded
adaptation, not the safety of importing the original automation.

| Rank | Candidate / decision | Benefit / frequency / risk reduction | Effort / maintenance | Why |
|---|---|---|---|---|
| 1 | **Update-existing/adapt:** `e2e-reviewer` principles into `operational-browser-verification` reference material | 4 / 4 / 5 | Small–medium / medium | Catch tests that pass through missing awaits, swallowed assertions, wrong auth surface, empty fixtures or optimistic-only persistence proof. Do not install its scanner/probe system. |
| 2 | **Add/adapt:** Trail of Bits `dimensional-analysis`, proposed project identity `production-unit-audit` | 5 / 3 / 5 | Medium / medium | A systematic unit vocabulary and propagation method adds something beyond tracing a single wrong number. Replace its plugin/multi-agent annotation machinery with bounded read-only analysis. |
| 3 | **Update-existing/adapt:** selected Supabase PostgreSQL references into `drizzle-best-practices` | 4 / 3 / 4 | Small–medium / small | Reusable query-plan/lock/pool evidence procedure; existing memory records incidents but does not supply this whole diagnostic method. Do not import a second broad schema authority. |
| 4 | **Update-existing/adapt, low priority:** Web Quality Skills `accessibility` into operational browser references | 3 / 2 / 3 | Small / small | More explicit keyboard/focus/status-message review, with a concrete upstream contrast-unit error corrected. Existing axe and responsive coverage remains authoritative. |

No unmodified **accept** recommendation. Approval must name the selected
adaptations, editable destination, notice retention and evaluation scope.
No credentials, paid service, physical device or product decision is needed to
finish this research. Adoption approval is a separate permission, not missing
research evidence. Keep these recommendations consolidated; no candidate tasks
were created.

## Evidence, inventory and method

- [Search ledger](external-skill-search-ledger-2026-10-23.md): queries, sources,
  exclusions, immutable repository revisions and license evidence.
- [Public source manifest](evidence/external-skill-sources-2026-10-23.json):
  182 fetched public files with exact URL, revision, byte count and SHA-256.
  Fetching a file is not proof that every executable path was security-audited.
- [Search results](evidence/external-skill-searches-2026-10-23.json): nine
  query groups and returned URLs/snippets; snippets were discovery hints only.
- [Uploaded archive inventory](evidence/external-skill-archives-2026-10-23.json):
  metadata-only safety evidence for 12 relevant archives, verified before
  opening selected `SKILL.md` and license text in memory. No extraction.
- Catalog command:
  `bash scripts/src/run-release-node.sh pnpm --filter @workspace/scripts run check:skill-catalog --json`.
  Result: 30 project-owned, 1 custom, 68 platform and 48 secondary skills.
  Zero failures; 33 warnings (31 documented, two undocumented managed-path
  references). One baseline drift reports an old managed warning now absent.
  This is inventory correctness, not a trigger or quality benchmark.

Public GitHub commit/tree/raw-file reads were anonymous and bounded; no
installers, candidate scripts, packages or hooks ran. Retained evidence contains
public metadata and minimized research findings, not workbook rows, credentials,
personal records, authenticated traces or production data. Temporary source text
is not installed in any skill root. Entire archives, benchmarks, translated
mirrors, fixtures and repository-level agent instruction files were not copied.

## Current versus dated plans

1. **Internal coverage is already improved.** The catalog README routes PWA
   recovery, QC decisions, schema safety and operational browser evidence. The
   earlier internal audit explicitly excluded third-party adoption; its original
   problem statement is not proof those routes are still absent.
2. **QC proposal is historical, not an implementation checklist.**
   [The October 16 proposal](qc-allergen-phase2-proposal.md) remains marked
   unapproved. Current
   [QC routes](../artifacts/api-server/src/routes/qcWorkflows.ts) include
   `/qc/allergen-activity`, `/qc/component-checks`, `/qc/label-references`,
   `/qc/label-checks`, `/qc/brix-targets`, `/qc/brix-checks` and correction/redaction
   paths; code also recognizes date-code events. This establishes existing
   implementation surfaces, not blanket approval of every proposed Phase 2
   policy or proof that each future criterion is complete. QC Intelligence
   Reports is active; Brix reviewed-source and maintained-source-list ideas
   already have separate proposed owners. Do not open duplicate work.
3. **Decomposition is selective and partly measured.**
   [Current roadmap](next-app-decomposition-roadmap-2026-10-16.md) includes the
   October 20 graph addendum: named panels are deferred, 36,088 gzip bytes in
   deferred chunks. This is not a historical byte delta or measured startup
   gain. Current [Home](../artifacts/run-calculator/src/pages/home.tsx) and
   [live context](../artifacts/run-calculator/src/contexts/LiveRunContext.tsx)
   retain shared orchestration. Component advice cannot move canonical state,
   clocks, sync transactions or auth into a new store/service.
4. **Local AI is not an unbuilt generic evaluation feature.**
   [Evaluator](local-ai-evaluation.md),
   [retained results](evidence/local-ai-evaluation-results-2026-10-16.md),
   [evaluation library](../lib/ai-evaluation/src/index.ts) and
   [candidate adapter](../lib/ai-evaluation/src/localCandidate.ts) establish
   pinned CPU evaluation, synthetic fixtures and deterministic gates.
   [Local deployment](local-ai-deployment.md) describes adapter/legacy container
   options; it does not authorize replacing the current Gemini production route
   or running Docker in this Replit workspace.
5. **Task ownership checked against supplied current board.** Server authority,
   guarded undo, Packaging manual-edit recovery, responsive repairs, stock
   correction persistence, preview invalidation, validation-runtime reliability
   and smoke-image changes have existing owners. During this review the
   TypeScript-report and schedule-preview tasks changed to IMPLEMENTED awaiting
   approval; neither status proves those edits are merged into this baseline.
   New midnight/selected-run preview suggestions also stay with existing work.
   No parallel task has the same external-skill discovery objective in the
   supplied records; the board is a snapshot, not a claim of live global access.
   Later supplied updates mark Windows metadata support and removed-slot stock
   correction preservation MERGED, and surplus correction active awaiting input.
   Those updates do not change this research objective or authorize duplicate
   implementation in the isolated baseline.

## Adoption briefs

### 1. False-green E2E review — update existing guidance

**Original:** [voidmatcha/e2e-skills](https://github.com/voidmatcha/e2e-skills/tree/1e77cba3b9fdcfb27ab160073f5151678c3781e2/skills/e2e-reviewer).
Actual skill, references, root/per-skill Apache-2.0 license and NOTICE reviewed;
see source manifest for hashes. Repository commit: 2026-10-23. Tests, scanner,
references and benchmark directories demonstrate active development structure,
not independent proof of effectiveness.

**Footprint:** upstream candidate subtree has 180 dotted file paths, including
47 script/vendor paths and 37 reference paths. These are inventory counts,
including resources, not 180 skills. It contains Python/shell/Node helpers,
vendored TypeScript and optional app-fault execution adapters. Review focuses on
instructions and selected safety/reporting/pattern references; executable safety
is not certified. Proposed adaptation copies no scanner, probes, vendor code,
eval payloads, `agents/openai.yaml`, installer or marketplace metadata.

**Trigger:** reviewing passing Playwright tests or a changed spec for whether
they prove the promised user outcome. Not runtime failure diagnosis, writing a
new test, ordinary unit tests, or a reason to launch a browser. Destination:
new concise reference routed from project-owned
`operational-browser-verification`, not another mandatory whole-suite skill.

**Safety/compatibility:** static review needs repository tests and source only.
Runtime probes can mutate application state, read environment/auth material or
produce sensitive traces; exclude them. Keep severity evidence-based; a textual
pattern is not automatically a P0 defect. An SSE app must not acquire a generic
`networkidle` wait. Real backend writes are appropriate only within existing
disposable test fixtures; do not replace them with mocks merely to satisfy a
smell rule. Preserve local startup, capability, scope and reload checks.

**Acceptance:** retain Apache license/NOTICE and mark adapted material;
use the shared pilot procedure below with cases E1–E3. Require identification of
both deliberately vacuous tests and acceptance of the justified negative/cleanup
case without a false finding. No runtime execution, broad refactor, scanner or
new task suggestions should be emitted by the static pilot.

### 2. Production unit audit — add a narrow adapted guide

**Original:** [Trail of Bits dimensional-analysis](https://github.com/trailofbits/skills/tree/196a9073ab10d35bacf111f945e02c00b2c6883a/plugins/dimensional-analysis).
Root CC-BY-SA-4.0 actual license reviewed; preserve attribution, adaptation notice
and ShareAlike terms for derived skill material. This is not a legal conclusion
about unrelated app code. Repository commit: 2026-10-23; phase-specific agents,
references and tests are present. No external model-performance claim adopted.

**Footprint:** plugin subtree has 46 dotted file paths, eight reference paths,
no script paths; native agent dispatch and five named role prompts are central
to the original workflow. Original annotations write across source files.
Neither plugin registration nor the source's `allowed-tools` grants authority
on Replit. Proposed guide is text-only, single-agent, selected-file analysis
producing a unit table and findings; no annotation or formula edit by default.

**Trigger:** explicit audit of several related formulas, mixed-unit computation
or scale conversion. For one wrong displayed value, start with
`wrong-number-triage`; for changing timers/claims use state and sync specialists;
for a pure algebraic invariant use the existing property-testing skill.

**Adaptation:** translate token/WAD/RAY concepts to oz/pizza, lbs/batch,
pizzas/case, cases/minute, seconds/minutes, fractional batches and Brix.
Same physical dimensions do not imply same semantic unit: sauce oz/pizza and
total lbs/batch, or measured Brix and weight tolerance, cannot substitute.
For each formula retain source, numerator/denominator, rounding, remainder,
zero/unknown behavior and station-specific demand cap. Unknown pizzas-per-case
must not become a plausible zero/need. Prep consumption and later prepared stock
use cannot be charged twice. This is a method gap, not missing domain authority.

**Safety/compatibility:** read-only synthetic examples and pure TypeScript fit
this project. Remove automatic annotations, dispatch, permission shortcuts and
DeFi-specific assumptions. Never silently defer concrete unrelated safety errors
as the upstream narrow reporting rule suggests; use owning-task failure closure.
No customer workbook, database, network or new dependency is required.

**Acceptance:** owner approves derivative license handling and proposed identity
`production-unit-audit`; no matching identity exists in the inventory. Evaluate
U1–U3 plus unseen unit/rounding variants. Reject any pilot that changes a formula,
flattens station behavior, invents a Brix target or confuses missing with zero.

### 3. PostgreSQL performance references — update Drizzle guidance

**Original:** [Supabase PostgreSQL skill](https://github.com/supabase/agent-skills/tree/c9be0e931b7930f7d02126d04774d904c381e7d7/skills/supabase-postgres-best-practices).
Actual root MIT license, copyright Supabase 2026, reviewed. Repository commit:
2026-10-02. Candidate version metadata 1.1.1 is an author declaration, not
independent compatibility proof. It has 36 dotted files, 34 reference paths and
no bundled script paths.

**Trigger:** slow scoped PostgreSQL query, pool exhaustion, long lock waits or
transaction duration, not every schema edit. Existing Drizzle guide remains the
router, with a performance reference for query plans and measured capacity.
Portable guidance does not need Supabase services, credentials or a new pooler.

**Adaptation:** keep selected `monitor-explain-analyze`, query-index,
`conn-limits`, `lock-short-transactions` and deadlock-order reasoning. Strip
illustrative 10–100x gains and pool sizing formula as project recommendations;
derive bounds from measured workload and actual backend capacity. `EXPLAIN
ANALYZE` executes a query: never recommend it on an arbitrary write or production
statement. Plan-only/static analysis first; authorized disposable measurements
only when needed. Do not suggest installing extensions, PgBouncer, enabling RLS,
changing server settings, unbounded `pg_stat_activity` captures or importing
Supabase Auth/Realtime. Session/advisory-lock assumptions require review before
any pool topology change.

**Version boundary:** catalog/lockfile specify Drizzle 0.45.4 and React 19.3.1;
web manifest declares Playwright ^1.64.0. Match installed APIs. Preserve
[Drizzle adaptation](../.agents/skills/drizzle-best-practices/SOURCE.md):
MIT uploaded archive identity remains explicit, upstream identity unverified,
no default RC upgrade, ID-generator conversion, direct production migration or
raw DB-error logging. Schema checklist, OpenAPI/codegen and Replit Publish
authority remain unchanged.

**Acceptance:** MIT notice retained; no second schema skill or provider setup.
Evaluate D1–D3; require plan-only advice for the write, exact sample/environment
qualifiers for capacity and no inferred permission to access production data.

### 4. Accessibility reference — bounded, low-priority update

**Original:** [Web Quality Skills accessibility](https://github.com/addyosmani/web-quality-skills/tree/afa8da942115f2961fdbfa80807ea0b232ff6c00/skills/accessibility).
Actual root MIT license, copyright Addy Osmani 2026. Repository commit:
2026-08-24. Three dotted files, two references, no scripts. Version 2.0 is
metadata, not measured WCAG conformance.

**Trigger:** keyboard/focus, dialog semantics, accessible names and asynchronous
save/error announcements. Existing operational browser owner and axe suites
remain primary; no blanket Lighthouse run for ordinary app changes.

**Required correction:** upstream contrast table incorrectly uses 18px/14px bold
for large text. [W3C SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
uses 18pt/14pt bold, approximately 24px/18.67px. Do not copy the bad table or
jurisdiction-wide legal assertions. Keep native controls, visible focus,
keyboard dismissal, focus restoration, status announcements and contrast
checks; a score of 100 is not compliance.

**Safety/compatibility:** remove Chrome DevTools MCP-specific calls and fallback
installation commands; use existing approved tools/fixtures if execution is
actually needed. Authenticated page reloads and stored traces can lose/expose
operational state. Static review is available without browsing; browser proof
uses disposable fixtures under existing guidance. No physical-device claim.

**Acceptance:** MIT notice and W3C source retained; evaluate A1–A3. Reject the
pilot if it accepts 18px regular text at 3:1, replaces native controls
unnecessarily, claims screen-reader/device proof or triggers a release suite.

## Use-existing, defer and reject

| Candidate | Disposition and evidence |
|---|---|
| `property-based-testing` (Trail of Bits) | **Use-existing.** Installed project skill already has the same property catalog and domain routing; upstream is CC-BY-SA-4.0. Do not install another copy or conflate invariants with universal commutativity of sync writes. |
| `playwright-debugger` (voidmatcha) | **Defer**, independently licensed upstream Apache-2.0 + NOTICE is available. Uploaded version still lacks license and differs from reviewed upstream. Upstream subtree: 26 dotted files, five script paths, seven references; Python 3.9+ report/trace readers and strict launcher/acquisition gates. Existing operational/testing/error guidance already covers local failures. Adapting safe trace readers needs a separate execution/security evaluation, not a “rename tools” import. Use existing guidance now. |
| `playwright-test-generator` (voidmatcha) | **Defer**, same verified upstream licensing but uploaded bytes differ. Upstream subtree: 14 dotted files, no script directory; references same-directory exploration/preflight/scenario documents. Browser interception, CLI/session and exact-origin/egress containment are central, plus explicit scenario approval. This is not a portable static generator; Replit workflow/testing controls cannot simply be declared equivalent. Existing tests/triage suffice. |
| Vercel `composition-patterns` | **Defer** pending actual license/notice evidence, not lack of interesting guidance. Frontmatter says MIT, but reviewed tree has no LICENSE/NOTICE terms. Directory `composition-patterns` declares `vercel-composition-patterns`, violating local exact name/directory rule. React 19 API section is version-relevant, but blanket provider/lifting rules risk moving live state. No new services/stores or eager/static graph claims. |
| Vercel `react-best-practices` | **Use existing React guidance; defer copying.** Same license-evidence gap. Next.js/RSC/`next/dynamic`, SWR and new helper dependencies are not this Vite/React Query stack. Portable subscription/bundle ideas overlap the decomposition roadmap and existing clock-isolation checks. |
| Hugging Face `huggingface-community-evals`, `huggingface-local-models` | **Defer.** Actual Apache-2.0 root license; active repo commit October 23. Old search name `hugging-face-evaluation` does not exist as an actual current skill in the reviewed tree; canonical replacement candidates were read instead. inspect-ai/lighteval/vLLM/Transformers/accelerate/uv or model downloads/authentication are a significant new footprint. GPU/Hub tasks, remote handoffs and home-folder assumptions do not improve the pinned CPU synthetic evaluator enough to justify import. Revisit only for an approved new evaluation objective; no new runtime/provider/weights here. |
| Anthropic `xlsx` | **Defer/reject as a general replacement.** Actual per-skill terms are proprietary/service-agreement terms, not inferred Apache/MIT from the catalog. Restrict outside-provider reuse; no permission inferred here. openpyxl/pandas/markitdown/LibreOffice and recalculation workflows are not the native TypeScript import pipeline. “Use formulas”/recalc rules cannot overwrite native formula/cached-value evidence. Use existing import/export skills. |
| Anthropic `webapp-testing` | **Use-existing**, no new adoption. Python Playwright/server helper and `networkidle` examples add overlap and wrong defaults for a persistent SSE app. No provider helper copied or executed. |
| `offline-first-pwa` (mattiasgeniar) | **Reject as-is.** Three-file repository has no actual license; categorical cache-first/everything-precache rules and startup-performance claims are not project-specific evidence. Its two August commits do not establish long-term maintenance. Preserve current safe-state update and recovery policies. |
| `pwa-offline-first` (mayurrathi), `web-pwa-offline-first` (agents-inc) | **Defer at discovery**, not shortlisted. Search shows generic queue replay and conflict recipes; provenance, actual license and full source safety not independently reviewed. Source/dist mirror in agents-inc is one identity, not two skills. No verified increment over reset/stamp/server-authority guidance. |
| Trail of Bits `differential-review` | **Use-existing/defer import**, root CC-BY-SA terms verified. History/blast-radius method is potentially useful but overlaps local shipping/security/CI reviews; “UI/logging low risk” heuristic is inappropriate for operational auth and sensitive diagnostics. A new compulsory full report per small change is excessive. No separate review run was launched. |
| Microsoft Playwright planner/generator/healer and CLI skills | **Reference/defer**, authoritative documentation and repository tree were located, not reviewed as installable project adaptations. Framework automation is not a replacement for this app’s fixture/data-isolation or tool permissions. No framework initialization command ran. |
| Food safety/HACCP results | **Use-existing; no qualified external skill found in this bounded search.** Results were general food guidance/governance/catalogs, not a verified licensed skill with app-compatible advisory boundaries. This does not mean no such skill exists. Never import regulatory policy, default Brix limits, allergen clearance, holds or finished-label authority from search results. |
| `prc-release-ops` uploaded runbook | **Reject.** Explicitly instructs reducing required PR reviews to zero, merging, then restoring protection; also recommends PAT handling and stale bootstrap/platform assumptions. No license. A project-specific name and asserted owner acceptance do not authorize bypassing branch review. Use current release/Publish/source-evidence guidance instead. |

## Compatibility applicability and variant coverage

This is applicability analysis, not browser execution or app validation.

| Dimension | What adoption must preserve | Research execution status |
|---|---|---|
| Desktop Chromium/Chrome | Authenticated fixtures, static assertion quality, keyboard focus; do not assume no persistent network traffic | NOT APPLICABLE — no UI change |
| Desktop WebKit/Safari | Same outcome assertions, native controls, storage/TLS fixture caveats; Chromium tooling is not WebKit proof | NOT APPLICABLE — no UI change |
| Phone portrait/landscape, both engines | Scroll/reachability, safe areas, fixed tabs, error/save feedback and touch/native-select behavior | NOT APPLICABLE — assessment only |
| Tablet portrait/landscape, both engines | Overlay viewport fit, focus and station navigation, no desktop-size assumption | NOT APPLICABLE — assessment only |
| PWA offline/slow/wake/update/run transition | Deferred-cache contract, opted-in/safe-state updates, epoch fencing, recovery before publishing, pause/run identity and idempotent claims | NOT APPLICABLE — no browser execution |
| Physical Android/iOS Safari/PWA | No requirement for this research; emulation never establishes physical-device proof | NOT APPLICABLE |
| Native mobile apps | Web-only product; no Expo/React Native skill adoption | NOT APPLICABLE |
| Workbook input/layout/locale | XLSX/XLS/XLSM/CSV/TSV distinctions; multisheet/merged/repeated headers, formulas and cached values, blank/zero, decimal/group separators, oz/lbs/batch/pizza/case, dates/local production day | Assessment coverage; no customer files processed |
| Roles/scopes/failures | Staff/QC/manager, live/sandbox/facility, revoked access, non-OK/unavailable source, stale writes, reset/purge, lost acknowledgment, retry/reload | Assessment coverage; no accounts or data touched |

Station coverage includes dough tray/batch supply and bought crusts; Press
progress versus line occupancy; Sauce barrel cadence versus Frontline/applicator
batch needs; mixes/cheese/prepared inventory units; Packaging case progress;
Freezer/Tunnel drain timing; and explicit Warehouse activity/staging evidence.
This does not assert each station has identical auto-tracking implementation.
Review current hooks, `LiveRunContext`, `lib/inventory-math` and existing
state/sync skills when adopting; do not convert explicit confirmations into
inferred counter activity.

## Acceptance and evaluation procedure

[Bounded evaluation brief](external-skill-evaluation-brief-2026-10-23.md) contains
source-free positive, adverse and near-miss cases for every recommended adoption.
These are **plans, not executed model evaluations**.

For each approved pilot: re-fetch immutable source and verify hashes/notices;
snapshot the current editable skill; adapt only the approved prose; validate
metadata/local references with the project quick validator and catalog checks;
compare old-guide/no-guide versus adapted outputs on synthetic cases; use an
unseen paraphrase and a near-miss; grade safety/meaning before style. Require
all critical safety assertions, no new false positives on the justified cases,
and useful additional findings over baseline. If baseline already passes,
prefer use-existing rather than adding instructions. Retain limitations,
latency/token costs when available and reviewer judgment. Do not claim measured
improvement without an actual authorized comparison.

## Claim assessment and owning-task failure ledger

Claim review labels below assess this report's decision-critical claims, not
the external repositories' broad marketing claims.

| Claim | Assessment / confidence | Evidence / boundary |
|---|---|---|
| Existing domain skills cover most operational work | verified / high | Catalog and coverage routes; not a guarantee every future task will trigger correctly |
| Current QC extends beyond the historical proposal | verified / high | Current handlers named above; policy approval and completeness are narrower questions |
| Reviewed upstream browser skills have actual license terms | verified / high | Immutable per-skill/root Apache-2.0 license and NOTICE; old ZIP provenance is not thereby authenticated |
| Vercel MIT metadata is enough to copy | unsupported / high | No actual license/notice terms in reviewed tree; adoption deferred |
| Accessibility large-text px threshold is correct upstream | contradicted / high | Pinned table versus W3C; adaptation must use pt/CSS-pixel conversion |
| Reading candidates proves quality gains | unsupported / high | No paired model benchmark run; gains remain hypotheses |
| Domain safety gates stay authoritative | verified / high | Proposed text-only boundaries, no installation/runtime/config changes |

Summary: four verified, two unsupported, one contradicted decision-critical
claims; unsupported/contradicted external assumptions are excluded from the
recommendations, not silently adopted.

| Finding / check | Status | Evidence, resolution or accountable owner / next action |
|---|---|---|
| First catalog invocation passed literal `--` to the script | PASS — repaired | It failed `Unknown option: --`; reran the supported pinned command without the separator, exit 0. No config/dependency change. |
| First source-metadata read exceeded default byte budget | PASS — repaired | Explicit bounded larger read succeeded; no partial manifest retained as complete. |
| First local-link check referenced its own not-yet-written output | PASS — repaired | Verification output was created, then all 24 local links rechecked successfully; retained evidence preserves the initial cause. |
| A no-op documentation patch used nonexistent context | PASS — repaired | Patch made no change; replaced it with the intended exact-context ledger/update edits and checked whitespace. |
| Completion typecheck found malformed earlier station tests | PASS — repaired | Restored their fixtures and run-selection assertions from the last coherent version; the targeted station file passes 46/46 tests. No station behavior changed. |
| Completion typecheck found generated API output behind OpenAPI | PASS — repaired | Regenerated with the pinned Orval command; generated-output check and API-Zod tests pass. No handwritten API contract change. |
| Follow-up typecheck found stale live-calculation test inputs | PASS — repaired | Corrected the no-pizzas-per-case fixture and supplied matching ownership evidence to the canonical-schedule case; live-calc tests pass 27/27. |
| Old browser ZIPs lack license, differ from upstream SKILL hashes | MISSING — adoption only | Do not license/rebind old bytes from metadata. Owner may approve a newly pinned upstream adaptation; old uploads stay deferred. Research verification complete. |
| Vercel actual license terms | MISSING — adoption only | Reviewed entire tree and public search; owner/upstream must supply terms before copying. No blocked required research. |
| Unsafe release runbook guidance | FAIL — candidate rejected | No installation or branch-setting change. Existing release/branch policy remains owner. No further action unless a separately authorized rewrite is wanted. |
| Upstream accessibility contrast error | PASS — research repair | Recommendation explicitly corrects it against W3C; owner of future adaptation must retain correction. No upstream file modified. |
| Managed catalog reference warnings | MISSING — non-blocking platform evidence | `.local/skills/media-generation/SKILL.md:86` and `.local/secondary_skills/tiktok-ads/SKILL.md:114`; managed roots cannot be edited here. Platform catalog maintainer owns correction; recheck refreshed catalog before work relying on those links. Unrelated to recommended skills. |
| Old managed warning baseline drift | PASS — classified | `query-integration-data` line-limit finding is now absent; do not edit managed content or silently change the baseline in this research task. Catalog maintainer may reconcile on next refresh. |
| Source/license identity, deduplication, report references | PASS | Focused research verification recorded in ledger. No metadata-only license accepted. |
| Adoption/model trigger or quality tests | NOT REACHED — permission boundary | Planned, not required for this research. Owner first selects/approves adaptations; agent then runs bounded comparisons. |
| Full repository typecheck | PASS | `pnpm run typecheck` completed successfully after the test and generated-output repairs. |
| Generated API checks and API-Zod tests | PASS | `@workspace/api-spec run check-generated` and `@workspace/api-zod run test` passed. |
| Targeted station and live-calculation tests | PASS | `LiveStationStartup.test.tsx`: 46/46; `@workspace/live-calc run test`: 27/27. |
| Build, database, browser, release, workflow restart | NOT APPLICABLE | No runtime behavior, database, dependency, deployment or workflow changes; these checks are not evidence required for this research. |

**First action:** approve or decline the single consolidated text-only pilot
set, preferably beginning with rank 1. **Do not add:** generic sync/PWA, runtime
AI tools, broad schema replacements, provider automation, a native-mobile
catalog, duplicate review skills or the release runbook. Missing license and
provider/tool semantics are real boundaries; routine public research required
no user intervention. This report is not a production-readiness decision.
