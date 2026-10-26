# Source and idea register

Assessment date 2026-10-26; source revision **B =
`ded88b96104b58eea47cf36e66204cd4d79d5409`**. Links are repository-relative and
retain original source chronology. “Inspected” means selected decision-relevant
sections/claims, not a full audit of every statement. The inventory's metadata-only
default applies unless this register or the matrix explicitly narrows it.

## Authority and precedence

1. Current user-authorized task scope and explicit recorded owner decisions.
2. Implemented contracts, corroborated across UI/API/data and applicable tests.
   Implementation is evidence of presence, **not retroactive policy approval**.
3. Revision-bound execution evidence, limited to its actual environment/build.
4. Approved plans for intended behavior, not claims of delivery.
5. Proposals, external reports, experiments and historical research.

Task Markdown files are local plans, not the live task database, hidden
conversations or proof of merge/approval. The only current task state used is
the supplied board/updates. Contradictory old plans remain linked and explicitly
superseded for status; no source document was silently rewritten.

## Decision-relevant local sources

| ID / domains | Origin, effective chronology and link | Authority / idea disposition | Reconciliation / conflict |
|---|---|---|---|
| S01 / all | Repository [Idea Backlog](../idea-backlog.md), reconciled Oct 8 | Mixed proposals plus historical capability snapshot | QC and source/import/inventory status lags later implementation. Not current acceptance criteria. |
| S02 / all | Uploaded [Full Plan](../../attached_assets/FULL-PLAN-production-run-calculator-2026-10-03_1791084665943.md), Oct 3, reconciled Oct 8 | Historical ordering authority asserted by S01; not blanket approval | Retain product constraints; replace its capability status with matrix evidence. QC “gated/unbuilt” and old published producer statements cannot describe B. |
| S03 / all | [Improvement](../improvement-research-2026-09-18.md) and [Further Research](../further-research-2026-09-18.md), Sep 18 with later edits | Research/recommendation | Inventory, QC and device-health gaps must be narrowed; “cleaning gate must” is superseded by approved advisory QC contract. |
| S04 / architecture/security/data | [Additional domain synthesis](../../research/additional-domain-research-synthesis-2026-09-19.md), [pre-implementation pack](../pre-implementation-research-pack-2026-09-19.md), Sep 19 | Research, not provider/migration permission | Discovery inputs for hybrid ownership, verification and policy prerequisites. Not proof of production topology. |
| S05 / sync | [Unified plan](../sync-reliability-unified-plan-2026-09-19.md), Sep 19 / Oct 8 | Maintained contract/research authority | Complete/partial fencing already implemented. Optional encoding and capacity hypotheses remain conditional. |
| S06 / sync | [Assigned baseline plan](../../.local/tasks/sync-tracking-research-comparison.md), Oct 26; source `f71e12248fee` initial comparison | Existing deeper assessment owner #3712; latest supplied state IMPLEMENTED | Consume available initial findings and prior reports only. Final new deliverable was not present in B. Old `webPush` index-zero observation superseded by S10/current source. No duplicated measurements. |
| S07 / lifecycle | [Server live-state authority](../server-live-state-authority.md), accumulated Oct 23–26 | Implemented contract and scoped execution evidence | Commands, counters, rejection recovery, End/history/inventory are server-owned. Full-suite failures, partial runs and final selected passes remain separate. |
| S08 / sync/performance | [Auto-track audit](../auto-track-sync-reliability-audit-2026-10-19.md), [recovery performance](../sync-recovery-performance-2026-10-19.md), Oct 19 | Historical source/controlled measurements | 36 peer adoptions, median 342.5 ms / p95 392 ms / max 469 ms are not a current deployed SLO. |
| S09 / runtime | [Stall investigation](../evidence/production-stalls-2026-10-26.md), Oct 26 | Evidence-limited diagnosis and prospective instrumentation | Explicitly not a root-cause repair or reason to increase pools/timeouts. Retained production observations were read, not re-probed. |
| S10 / notification/stations | [Shared live identity verification](../shared-live-station-run-identity-verification.md), current Oct 26 integration; `webPush.ts` at B | Implemented canonical selector | Current candidate reads `selectCanonicalLiveRun`; normalized single-run calc input with `currentIndex:0` is not the obsolete fallback. Delivery effectiveness still environment-specific. |
| S11 / development DB | [Generator health](../evidence/development-generator-health-2026-10-26.md), Oct 26 | Implemented serial-schema diagnostic and local evidence | Supersedes old “convert to identity to fix diagnostic” inference. Historical migration helpers are not supported startup/Publish migrations. |
| S12 / imports | [Import system](../import-system-plan.md) + [audited safety](../evidence/audited-import-safety.md), reconciled Oct 22 | Implemented seven-path contract; bounded execution | Atomicity for three importers, local receipts/per-day saves for others. Real spec commit journey incomplete; shared component cases not end-to-end importer proof. |
| S13 / imports | [Importer redesign](../importer-redesign-plan.md), historical plan; [mixed review](../mixed-workbook-review.md), current contract | Mixed implemented/proposed | Provenance, templates, structured diff and inventory impact now have code; universal auto-verify/batch Apply still not implied. Source absence cannot delete factory data. |
| S14 / source integrity | [Source review](../evidence/source-library-pool-owner-review-2026-10-12-v2.md), [export audit](../evidence/export-integrity-audit-2026-10-18.md), [lifecycle audit](../import-lifecycle-integrity-audit-2026-09-06.md) | Scoped historical source/accounting evidence | Current owner-reviewed exceptions need fresh fingerprints; snapshots are not independent truth. No workbooks reopened for this report. |
| S15 / inventory | [Gap analysis](../inventory-gap-analysis.md), [auto-deduction](../inventory-autodeduction-plan.md), [overproduction](../overproduction-surplus-plan.md), updated Oct 22 | Implemented accounting with remaining policy gaps | Actuals, final corrections, prep handoff, finished-case damage/return exist. Dedicated raw waste/returns still policy-gated. |
| S16 / inventory | [Accounting evidence](../evidence/inventory-accounting-2026-10-22.md), Oct 22 | Retained disposable PostgreSQL and pure checks | Rebased source `d3ee9007b2491be49a104a2c3e893b1b6e3ef35a`; patch identities/file hashes are in the original report. Not new tests at B or physical reconciliation. |
| S17 / planning | [Lookahead](../multi-day-lookahead-plan.md), [reporting](../production-reporting-plan.md), [stoppage analytics](../stoppage-analytics-plan.md) | Partial capabilities plus future proposals | Existing summaries/logs/snapshots are not a unified multi-day resource planner or automatic cost accounting. Some export gaps need narrowing to non-operational report types. |
| S18 / breaks | [Repair plan](../../.local/tasks/repair-break-planning-and-estimates.md), Oct 26; #3709 IN_PROGRESS supplied board | Approved active repair, not completed in B | Owns picker/projection validity/persistence; no competing implementation or inferred fix from source presence. |
| S19 / QC | [QC plan](../qc-department-plan.md), [allergen plan](../allergen-tracking-plan.md), [approved Phase 1 decisions](../../.agents/memory/qc-allergen-phase1-decisions.md) | Approved non-blocking contract; later features require their own sources | Overrides September hard-gate research. Never infer reviewed-empty from missing. Indefinite retention/reset/purge survival with audited correction/redaction. |
| S20 / QC | [Phase 2 proposal](../qc-allergen-phase2-proposal.md), Oct 16 | Explicitly unapproved proposal/historical gap list | Current implementations cover several candidates; not authority for holds, declarations or arbitrary source criteria. |
| S21 / QC | [Intelligence coverage](../evidence/qc-slice-7-intelligence/coverage-check-map.md), [failure ledger](../evidence/qc-slice-7-intelligence/failure-ledger.md), [responsive repair](../qc-responsive-repair-verification-2026-10-23.md), Oct 23 | Scoped synthetic source/API/browser evidence | Intelligence manager controls, filtered CSV, error/retry/reload/denial evidenced; exact captures carry own revisions. Earlier slice captures unavailable in reviewed checkout. |
| S22 / UX/PWA | [PWA repair](../pwa-update-repair-evidence.md), [floor controls](../real-device-floor-controls.md), [screen-off protocol](../screen-off-wake-test-protocol.md) | Implemented policy, historical emulation, physical protocol | Safe updates and queue ownership must survive lazy loading; no physical Android/iOS or battery pass inferred. |
| S23 / security/CI | [Security/CI dispositions](../evidence/security-ci-report-dispositions-2026-10-24.md), Oct 24, baseline `2a6ff7524be8d0e6944d68d80dee58f414cbce3d` plus recorded patches | Reconciled external allegations, implemented bounded repairs | Public diagnostics disclosure repaired. Gold approval remains attestation; protected inputs unavailable to untrusted PRs intentionally BLOCKED. No blanket scan/security clearance. |
| S24 / AI | [Feature-value audit](../ai-feature-value-audit-2026-09-05.md), [retained contracts](../retained-ai-service-contracts.md) | Audit recommendations versus later implemented simplification | Deterministic compatibility URLs under `/ai` are not proof model-backed chat remains. Preserve extract/resolve and shared safeguards. |
| S25 / AI | [Local evaluator](../local-ai-evaluation.md), [results](../evidence/local-ai-evaluation-results-2026-10-16.md), Oct 16 | Evaluation-only infrastructure and synthetic experiment | INSUFFICIENT EVIDENCE for adoption. Qwen3.5-9B pinned CPU/4096 context/256 output; tiny smoke, no paired Gemini baseline. |
| S26 / AI/privacy | [Gold review](../spec-import-gold-review.md), [Gold Lab](../evidence/import-gold-lab-2026-10-21.md), [knowledge](../ai-knowledge/README.md) | Implemented opt-in tools; source/retention/privacy approval separately required | Apply-derived expected values are not automatically independent blind gold. Lab retention/export and local endpoint availability are distinct gates. |
| S27 / AI future | [Local deployment](../local-ai-deployment.md), [self-hosted options](../option-b-self-hosted-ai-deep-dive-2026-09-26.md), [QLoRA](../qlora-distillation-techniques-2026-09-28.md), [promotion bar](../evidence/conditional-qlora-promotion-bar-2026-10-02.md) | Deferred/conditional experiments, historical container options | No training, uploads, second OCR, production routing or Docker workspace authorization. |
| S28 / architecture | [Decomposition roadmap](../next-app-decomposition-roadmap-2026-10-16.md), Oct 16 with Oct 20–21 evidence | Research recommendation, measured internal boundaries | Four named panels deferred (36,088 gzip bytes in historical matching graph); no same-source speed delta. Keep app/API/canonical ownership. |
| S29 / performance | [Graph measurement](../evidence/home-opening-graph-measurement-2026-10-20.md), [byte-guard decision](../evidence/home-opening-byte-guard-decision-2026-10-21.md), [budgets](../../artifacts/run-calculator/docs/performance-budgets.md) | Historical revision-bound build measurements and distinct targets | Three source-matched Oct 21 builds reproducible; startup/first-use tails remain a different measurement. Do not reopen fixed static-edge warning. |
| S30 / release/recovery | [Release matrix](../test-release-matrix.md), [browser inventory](../full-browser-inventory.md), [handoff](../release-evidence-handoff.md), [operations](../release-operations.md) | Current verification contracts; execution owned elsewhere | Current full certification unresolved. Checkpoints ≠ terminal reports; mismatched revisions ≠ a composite PASS. Replit Publish authority, not old provider runbooks. |
| S31 / maintenance | [External skill research](../external-skill-research-2026-10-23.md), [search ledger](../external-skill-search-ledger-2026-10-23.md), [pilot brief](../external-skill-evaluation-brief-2026-10-23.md) | Reviewed recommendations, not installed/evaluated improvements | False-green/static review, unit-analysis and DB references are bounded candidates; do not bulk install or add redundant safety authorities. |
| S32 / branch history | [Oct 20 reconciliation](../reconciliation-report-2026-10-20.md), [branch claims](../branch-claims-validation-2026-10-23.md), [recovery parity](../recovery-operations-parity.md) | Historical selective comparison, not proof all upstream changes desirable | Preserve intentional diagnostics, errors and source semantics; later serial diagnostic contract supersedes earlier conversion speculation. |

## Uploaded sources, duplicates and unavailable content

- Uploaded Full Plan, consolidated backlog, QC-completion and import/inventory
  research task packs were inspected at heading/status/decision level. They are
  ideas, not executable task instructions or automatic implementation approval.
  The metadata catalog preserves their exact paths and hashes. Their relevant
  current claims are covered by S02, S12–S21, S25–S31.
- Uploaded September research often shares the name of maintained docs but has
  different bytes. Prefer the maintained source for current status; preserve the
  upload as historical. Exact-byte duplicates (e.g. repeated security report and
  PDF uploads) are grouped by hash; similar names/dates never establish equality.
- DOCX security/branch reports are represented by S23/S32's existing bounded
  dispositions. Their original binaries were inventoried, not freshly converted
  or executed. Other DOCX research with matching maintained Markdown is treated
  as a candidate family, **not proven equivalent text**. Unmatched unique DOCX
  ideas remain metadata-only discovery gaps.
- Three uploads of the broad software-development PDF are inventoried as binary
  candidates; no page/text/visual review was performed. No recommendation relies
  on their content. They could contain additional external ideas; those are not
  characterized as approved, rejected or already implemented.
- 113 ZIPs are metadata candidates, not 113 reviewed skill bundles. No archive
  member was extracted/opened here. S31 retains an earlier selected 12-archive
  review; that does not cover the rest. Large files over 10 MiB are not hashed
  by this inventory. No license or safety inferred from an archive name.
- Customer workbooks, images, source-library audit files and diagnostic uploads
  were inventoried only. Existing minimized source/export/lifecycle assessments
  supply the relevant evidence. This task did not ingest workbook contents,
  transcribe photos or publish raw diagnostic payloads.
- Metadata-only research, plan and memory records remain searchable; no hidden
  chat, remote task history, GitHub live status, connected-service record or
  restricted approval document was available/retrieved. No integration is
  connected in supplied context. No inference of rejection from archived
  suggestions or of approval from a filename/commit subject.

## Accessible task chronology

| Owner | Supplied current state / evidence boundary |
|---|---|
| #3712 sync/tracking baseline | Initially IN_PROGRESS; later update IMPLEMENTED. This is a task-state observation, not a fresh source merge or access to its final report. |
| #3709 break planning and estimates | IN_PROGRESS; local plan inspected; source still evaluated at B. |
| #3692 full browser suite | IN_PROGRESS, waiting for input; no new certification attempted. |
| #3696 local-release checks / #3697 partial-result retention | PROPOSED; not assumed implemented. |
| #3716 manager sync health / #3717 stall attribution | PROPOSED; consume existing ownership, do not duplicate. |
| #3718 background-health warning endpoint / #3719 handlers declared but not connected | PROPOSED in late supplied update. Independently inspected B's router composition, client and isolated test; M41 records the narrowed source finding, not a runtime result. |
| App-wide reconciliation | This record owns discovery, interpretation, limitations and recommendations only. No other scope/status changed. |

## Execution-evidence identities used by this synthesis

These are historical artifacts read here, **not commands executed here**.
The catalog hashes each retained report at assessment time; original reports
retain fuller source hashes, command results and failure/cancellation history.

| Evidence | Date / build identity / environment | Binding limitation |
|---|---|---|
| S07 server authority | Accumulated implementation/verification report through Oct 26; earlier and later passes have different command/source contexts and retained hashes | Not one terminal full-suite run. Follow each report section's command/log/fingerprint rather than assigning B to all counts. Some ignored evidence paths are unavailable in this fork. |
| S12 audited imports | Oct 22; base `13f80b639831637df2806b0cf9251817f87e719f`, changed-source bundle `654db6c512e5495338ed93820ae7d0c9bbd6405aaaec452c1ab4904eb0db3486`; isolated synthetic DB/browser | 56-file bundle is not a clean base commit. Overlay fix not re-proved through successful real commit browser journey. |
| S16 inventory | Oct 22; post-rebase `d3ee9007b2491be49a104a2c3e893b1b6e3ef35a` plus patch `7e574ebcc018204acf42613c3b86cd4191bb8661a421de348e84d6e83d6765fd`; disposable PostgreSQL 16, local Linux/pinned Node | Original pre-rebase counts and post-rebase selected counts are separate. No current physical accounting or production proof. |
| S21 QC report browser captures | Oct 23 16:45–16:52 UTC; all eight `*-browser-result.json` records say revision `5ad8da2071a1bbf78d2af87c7d473a7a40ec5257`, sourceState “current workspace including task changes”; isolated DB/API/web | Chromium/WebKit desktop, phone and tablet portrait/landscape, all recorded PASS. Revision plus dirty sourceState is not proof a clean commit exactly reproduces tested tree; service workers blocked for injected API failure. |
| S23 security/CI | Oct 24; `2a6ff7524be8d0e6944d68d80dee58f414cbce3d` plus described repairs; protected-input source fingerprints in original report | Local source/build validation, not live trusted remote CI or full security certification. Source includes restricted inputs that are not exported by this report. |
| S25 local model | Oct 16; runtime Ollama distribution v0.40.5 / bundled `llama-server` `620d2225c`, pinned model repository revision `9345434ae3c14ecb7b5021df007518f70b2a5231`; private CPU loopback | Tiny synthetic smoke, one active request, no representative filled context or paired Gemini baseline. Exact model/binary checksums remain in original evidence. |
| S29 graph/budgets | Oct 20 graph source `85b20fed...`; Oct 21 source-matched repeated graph builds documented separately | Graph membership/gzip artifact measurements, not authenticated latency, transferred bytes, field performance or battery. Distinct source sets not combined as current performance proof. |
