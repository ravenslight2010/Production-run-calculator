# Research reconciled with the Production Run Calculator

**Assessment:** 2026-10-26. **Inspected source:** `ded88b96104b58eea47cf36e66204cd4d79d5409`.
**Owner:** assigned app-wide research agent. **Decision brief, not implementation approval or release certification.**

## The short answer

The app is substantially further along than the September backlog and October 3
Full Plan suggest. The most useful next work is to establish dependable operating
outcomes on the integrated build, finish the already-owned break/estimate repair,
and close the specific import journey evidence gap. Do **not** restart QC,
inventory accounting, delta sync, or local-evaluator setup as greenfield projects.
Keep one responsive web app, one authenticated API and canonical server-owned data.

Four distinctions matter:

1. **Implemented is not published or verified today.** Current source contains
   extensive safeguards; retained tests and browser reports describe their own
   builds. This assessment ran no application tests, browser certification,
   production query, provider evaluation or security scan.
2. **Diagnostics are not repairs.** The October 26 stall work adds useful phase
   attribution but does not establish a cause or fix. The development generator
   diagnostic repair does not establish production capacity.
3. **QC records are not food-safety clearance.** Existing component, label,
   date-code, Brix and intelligence features remain advisory and source-bounded.
   Unknown allergens stay unknown; reviewed-empty means none of the nine tracked
   allergens, not an allergen-free declaration.
4. **Evaluation infrastructure is not model adoption.** A working local synthetic
   smoke, a Gold Lab, and knowledge packages do not establish held-out accuracy,
   source-owner authorization or permission to replace Gemini.

## Read the evidence

| Record | Purpose |
|---|---|
| [Source register](sources.md) | Authority, chronology, duplicate/supersession decisions, accessible task context |
| [Searchable inventory](inventory.json) | All discovered local candidate paths, hashes where bounded, dates, origin, domain hints and duplicate families |
| [Outcome matrix](matrix.md) | Plans → UI/API/data → actual evidence limits → discrepancies, decisions and owners |
| [New primary research](primary-research.md) | Current primary sources, alternatives, applicability, costs and approval gates |
| [Coverage and failure ledger](coverage-ledger.md) | What was inspected, what remains unknown, status/owner/next observation |

The JSON is a metadata catalog, **not a claim that 1,889 sources were read**.
It includes 228 docs, 565 local task-plan files, 50 research files, 523 attachments,
517 memory records, three app-local docs and three root instruction/readme files.
The counts are mutually exclusive by origin. One more task-plan file was present
than the initial scoping count; this is discovery, not proof of another approved
task. The catalog found 124 exact-byte duplicate groups and 153 name/date family
candidates; families are not automatically duplicates or superseded sources.
Dates extracted from filenames are hints, never approval or effective dates.

## What old plans still call open but now exists

- **Imports:** seven-path final review/preflight, templates, structured changes,
  source comparisons, source/landed health, selected-run inventory impact,
  and mixed-file review navigation. Spec/premix/cheese have atomic Apply,
  original-request retry and guarded Undo. Guide imports and schedule retain
  narrower local/per-day guarantees; no universal atomic batch Apply exists.
- **Inventory:** actual-case deduction, saved final-total reconciliation,
  prep-made raw-stock accounting without charging raw ingredients again at End,
  packaging modes, freezer allocation, finished-case damage/returns and manager
  audit paths. The October 22 report contains disposable-DB verification, not
  production physical accounting certification.
- **QC:** retained lots/weights, allergen/cleaning reviews, sign-off and audited
  corrections/redactions; component/label/date-code/Brix workflows; import/recipe
  reviews and planning; daily allergen activity and manager intelligence reports.
  The October 16 Phase 2 proposal is historical input, not the current backlog.
- **Sync/lifecycle:** complete and partial snapshot fencing, command-owned live
  actions/counters, durable retry and outbox paths, recovery UI and canonical
  station selection. Background notifications now use `selectCanonicalLiveRun`;
  the older index-zero selection warning is stale for this source.
- **Architecture/AI:** API families and selective internal UI decomposition;
  measured deferred graph boundaries; a private pinned local evaluator,
  deterministic evaluation contracts, static knowledge, and opt-in Gold tooling.
  None of these proves current authenticated speed or production AI quality.
- **Security/operations:** public readiness diagnostics were reduced and rich
  diagnostics gated; restricted CI input delivery was addressed. The current
  development ID diagnostic follows the supported serial schema, not the
  historical identity-conversion rehearsal.

See individual claim labels in the matrix; this list does not promote all of
these features to fully verified current user journeys.

## What remains partial, contradictory or insufficiently evidenced

**Highest current operational uncertainty:** shared-update stalls, canonical
adoption on real deployed devices, and release/build-bound verification. Existing
owners already cover these outcomes. Full release certification is blocked by
waiting for input in the supplied board; no timing limit or gate is relaxed here.

**Concrete feature-evidence gap:** the audited-import report's real Chromium spec
journey stopped at an overlay interception. The layering correction has cheaper
checks but no retained successful browser Apply/history/reload for that journey.
The 56 shared-review viewport/engine/label cases are not seven real importer
journeys. API transactions cannot alone close that UI delivery gap.

**Source-confirmed wiring gap:** the manager background-warning handler exists
and has an isolated router test, but it is not mounted in B's API composition.
The new #3718/#3719 proposals already own endpoint restoration and assembled
handler coverage. This is not the separately mounted rich health-diagnostics
endpoint and does not reopen the repaired public-disclosure finding.

**Active user-facing repair:** breaks and timeline estimates have an existing
owner. Presence of a timeline function and five deterministic examples does not
prove the touch picker, saved settings or a dependable finish estimate when
inputs are missing.

**Useful but not approved product expansion:** unified multi-day prep/capacity,
dedicated raw-ingredient waste/returns, and broader cost/correlation reporting.
Finished-case returns, generic adjustments and waste-pound fields do not define
those physical accounting policies. QC traceability is exact lot-to-run evidence,
not a lot-to-customer recall/shipping system.

**Future AI blockers:** independent adjudicated cases, source-use and retention
authorization, paired Gemini/local evaluation and representative resource
measurements. Import Gold's post-Apply expected values are not independently
blind gold merely because a human clicked Apply.

**Performance gap:** deferred gzip bytes are measured, but current authenticated
startup/first-use distributions and physical battery measurements are not.

## Recommended roadmap: four coherent workstreams

These are reviewable recommendations, **not newly created tasks**. Priority and
effort are engineering judgments; no calendar or cost commitment is implied.
Existing task references below come from supplied accessible context.

### W1 — Dependable shift execution and honest verification — NOW

- **Outcome:** operators can trust run identity, shared progress, recovery and
  saved timing; managers can distinguish connected from current.
- **Evidence:** matrix M01–M07, M19–M20, M26–M28, M38–M41; existing authority,
  stall, release and break reports.
- **Risk of waiting:** recurring stalls or misleading estimates can affect a
  shift while diagnostics appear healthy. No incident cause is inferred.
- **Owners:** #3712 sync baseline (**IMPLEMENTED** per latest supplied update;
  final delivered report not available in this fork), #3709 breaks/timeline
  (**IN_PROGRESS**); #3716 manager sync health and #3717 stall attribution
  (**PROPOSED**); #3692 full browser certification (**IN_PROGRESS**, waiting for
  input), #3696 local-release and #3697 retained partial results (**PROPOSED**).
  Late supplied #3718 background-warning endpoint and #3719 assembled handler
  coverage are also **PROPOSED**, with source boundaries in M41.
  Preserve these separate existing scopes; do not create another umbrella task.
- **Dependencies:** consume #3712's actual revision-bound findings; correlate
  prospective stall phases only after an authorized serving build emits them.
  Break repair and source discovery need not wait for production metrics.
- **Effort/uncertainty:** medium for remaining UI/verification, high uncertainty
  for stall causality; no speculative pool, timeout, transport or provider change.
- **Acceptance:** retained per-flow results with canonical acknowledgment and peer
  adoption separated; healthy versus recovery latency distinguished; exact
  break save/reopen/reload and matched projection inputs; failures and unrun
  release cases retained under existing time limits. Production claims require
  serving-build identity, environment and authorized operational observation.
- **Owner decisions:** only existing certification input/access and any later
  infrastructure/publish choice; source research does not authorize a change.

### W2 — Verifiable source-to-stock changes — NEXT

- **Outcome:** a manager can inspect a real import, Apply once, recover an
  uncertain response, reload confirmed values, and understand the stock impact
  without believing every importer supports the same Undo.
- **Evidence:** M08–M18; audited-import and inventory-accounting reports. Current
  code supplies most foundations. The smallest immediate evidence addition is
  the real spec Apply/history/reload journey after the layering correction,
  with the existing isolated fixture—not another parser or whole-suite run.
- **Risk of waiting:** strong transaction evidence can conceal unreachable UI
  confirmation or uncertainty about which values were saved.
- **Owner:** future owner-approved import/inventory outcome maintainer;
  this assessment creates no implementation assignment. Existing source and
  inventory report owners retain their earlier results.
- **Dependencies:** supported format/unit contracts; exact request identity;
  local-versus-remote receipt boundaries; effective prep-stock handoff. Real
  source replay requires authorization; synthetic fixtures suffice for wiring.
- **Effort/uncertainty:** small-to-medium to close the named evidence gap;
  medium/high for any future unified prep or physical-loss accounting.
- **Acceptance:** successful real review→Apply→history→reload with actual
  persisted values; cancel sends no write; dropped response reuses identity;
  denied capabilities/scopes remain denied; source differences never imply
  deletion from workbook absence. Extend existing deterministic/API assertions
  only where the source-of-truth analysis identifies a missing invariant.
- **Owner decisions:** whether to prioritize unified prep after reliability;
  physical event/unit/return/waste policy before new stock writers. No
  automatic-Apply or universal batch rollback proposal is approved.

### W3 — Usable advisory QC with approved operating references — NEXT/LATER

- **Outcome:** QC staff can record and interpret checks, unknowns, revisions and
  sign-off without unsupported label/date/Brix or cross-contact conclusions.
- **Evidence:** M21–M25; intelligence has retained authenticated eight-variant
  browser evidence, including export, retry, reload and denial. Other slices'
  original captures are less accessible. Do not rebuild all QC under Phase 2.
- **Risk of waiting:** missing approved references may leave useful software
  unevaluable or lead users to overread a check as safety clearance.
- **Owner:** facility/QC safety and product owner for criteria; future approved
  QC maintenance owner for any software change.
- **Dependencies:** reviewed expected component/label/date sources, explicitly
  reviewed Brix targets, retention/export/privacy ownership and server snapshots.
- **Effort/uncertainty:** medium reference/operating review; high uncertainty
  for any new cross-contact/recall/hold policy, which is not recommended now.
- **Acceptance:** each displayed comparison names its approved source/version
  or remains not-evaluated; unknown != none; corrections reopen relevant review;
  scope/role/export boundaries and reset/purge retention preserved; lot-to-run
  trace remains distinct from shipment/customer genealogy. Do not invent limits.
- **Owner decisions:** authorized operating references and regulatory jurisdiction;
  separately approve any hold, label declaration or retention change.

### W4 — Evidence-led performance, AI and developer maintenance — LATER / EXPERIMENT

- **Outcome:** improve operator speed or maintenance only where measured,
  and evaluate local AI without creating a new production authority.
- **Evidence:** M29–M37 and primary research P01–P12. Keep the single app/API/data
  model. Choose a repeated change hotspot, not a file-size target.
- **Risk of waiting:** avoidable maintenance cost remains; premature services,
  installs or model routing would add larger unmeasured risk.
- **Owner:** product/engineering owner selects the objective; data/privacy/source
  owners authorize evaluation; no runtime/provider change assigned here.
- **Dependencies:** exact production-graph identity plus authenticated
  cold-start/first-use samples for a speed claim; license and controlled pilot
  for skill adoption; independently reviewed authorized paired cases for AI.
- **Effort/uncertainty:** small static guidance pilot, medium internal extraction
  or measurement, high model-quality/capacity uncertainty. Quantized CPU smoke
  at tiny inputs cannot predict full-context multi-user cost.
- **Acceptance:** preserve state/auth/transaction ownership; measure before/after
  in the same environment; no budget substitution; paired schema/critical-field/
  blank-poison gates remain frozen; blinded labels, privacy/deletion ownership,
  source identity and failures retained. If existing guidance already succeeds,
  prefer it over adding another skill.
- **Owner decisions:** performance versus maintainability priority; evaluation
  source-use/run/spend/retention authorization; separate approval for provider,
  architecture or derivative-skill adoption.

## Retire, defer, or preserve

**Retire as current backlog items:** “build delta sync from scratch,” “QC Phase 1
not yet built,” “component/label/date-code UI absent,” “prep never deducts stock,”
“actual/final stock corrections absent,” “local evaluator not installed/setup,”
“four panels still eagerly bundled” when based only on the old October 16
observation, and the old background-alert index-zero defect. Preserve their
historical dates rather than rewriting source evidence.

**Defer:** native mobile parity; separate apps/services/databases/auth/sync;
automatic import scheduling/batch Apply; restoration of removed mix carry prompts;
food-safety holds/declarations; raw-material waste/returns until policy; broad
assistant expansion; QLoRA/distillation/second OCR runtime without evidence.

**Preserve:** complete recovery and command authority; manual/derived allergen
separation; immutable records and audited corrections; supported unit/formula
provenance; exact retries; explicit source-owner approval; existing release
limits and publication authority.

## Decisions genuinely left to the owner

No answer is required to use this report. Recommended priority is W1, then the
bounded W2 evidence closure, with W3 operating-reference work in parallel where
qualified owners are available. Before authorizing later work, decide:

1. Whether unified multi-day preparation or dedicated physical-loss accounting
   is the next operator outcome after existing reliability work.
2. Who owns approved QC label/date/Brix references and any jurisdiction/customer
   requirements. Research cannot supply facility policy or certification.
3. Whether local AI evaluation merits authorized source use, retention and paired
   provider spend. “Keep Gemini” needs no new infrastructure decision.
4. Whether a future internal extraction is for maintainability or measured
   authenticated speed. No new deployable is justified by this assessment.

## Maintenance

Regenerate metadata with the command in `inventory.py`, then review changed
families. Add human-reviewed source/idea decisions to `sources.md` and outcome
rows to `matrix.md`; never infer approvals from catalog hints. Recheck affected
source edges and the evidence item's own build after merges. Do not bulk rewrite
historical reports or combine differing revisions into a current PASS.
