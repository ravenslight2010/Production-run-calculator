# V2 gaps and evidence ledger

**Review date:** 2026-11-10  
**Approved first-release scope:** run control, every production station, full
inventory, imports, multi-device sync, and auto-tracking; web/PWA first; read-only
offline; setup/master-data and account/role carry only; no historical run or
inventory-history transfer; fresh physical opening count.

Evidence labels describe support for a claim. Work status describes lifecycle;
they are not interchangeable.

## First-release gaps

| Area | Evidence label | Work status | Gap that matters to V2 | Smallest source-of-truth evidence needed |
|---|---|---|---|---|
| Run lifecycle and stations | Partially verified | V2 run-control foundation exists; full outcome not implemented | No live V2 host/auth adapter and no complete station-specific operations. V1 calculations and individual lifecycle tests cannot establish all station units, states, or physical output. | V2 API/transaction and domain tests for each accepted command, then one two-session browser journey for canonical state, stale conflict, reload, and recovery. V1 physical evidence is separate. |
| Inventory | Partially verified | V2 inventory not implemented | No lot/ledger workflow, correction conflict handling, cross-device adoption, or V2 opening-count operation. V1 balances and movements are excluded. | Disposable V2 database transaction tests for ledger/on-hand parity, idempotency, concurrency, and a reviewed synthetic opening-count workflow; actual physical count only at authorized cutover. |
| Imports and master data | Partially verified | V2 recurring imports not implemented; #3913 is a draft transfer proposal | Existing V1 import safety is importer-specific. A setup/master-data transfer is not the recurring operator import flow. | Deterministic source-format fixtures; manager review → one explicit Apply → history/reload; exact retry/lost-response behavior for each supported V2 importer. Use synthetic or owner-authorized sources only. |
| Authentication and roles | Partially verified | V2 authentication not implemented; #3914 is a draft | V2 handler has adapter boundaries but no V2-owned session implementation. Transferred identities must be revalidated; V1 secrets/session material cannot be reused. | V2 session/CSRF and authorization integration checks for manager/operator/anonymous, scope, revocation, fresh sign-in, and denied role mapping on an isolated V2 database. |
| Multi-device and offline | Partially verified | V2 protocol is specified; user journey not implemented | No completed PWA cache/status, cursor/snapshot recovery, or two-session convergence evidence. Offline writes are explicitly disallowed. | Browser integration with two independent sessions, stale-revision conflict, wake/reconnect adoption before writes, offline read-only state, reload persistence, and server revision equality. |
| Automatic tracking | Partially verified | Worker is planned, not implemented | No supervised worker, lease/fencing, idle no-work behavior, restart or duplicate-effect proof. | Disposable V2 database tests for claim/lease takeover, pre/post-commit crash, fencing, idempotency, and idle no-work; then a supervised-process pilot. |
| Cutover | Needs-human | Not run | Transfer allowlist, identity/role mapping, fresh physical count, old-session invalidation, and history/archive retention have not been executed or approved as an operational window. | Owner-approved cutover rehearsal using a disposable V2 database and synthetic or explicitly approved export; no V1 production connection from this task. |
| Deployment boundary | Partially verified | Platform documentation checked; V2 pilot not run | One-Reserved-VM/two-process topology is a documented candidate, not proof of shared DB behavior, restart recovery, publish compatibility, or capacity. | Separately provisioned V2 project and disposable DB; API/worker marker exchange, process and whole-deployment restart, harmless publish, and measured aggregate pool budget. |

## Decision and evidence ledger

| ID | Status | Evidence and reason | Accountable owner | Next action |
|---|---|---|---|---|
| G01 — V1 app-wide audit freshness | Partially verified | The archived app-wide audit's current overlay ends 2026-11-04 and records checkout `6db5dcb…`; this package inspected checkout `dc6e5205f55fa74005373c6d7f06fae8df0f3399` on 2026-11-10. Selected current V1 files and 286 focused tests were checked; the full V1 audit was not repeated. | V1 domain maintainers for changed behavior; release owner for release claims. | Recheck only an affected source/test path when a V2 implementation decision depends on newer V1 behavior. Do not combine historical evidence into a current release PASS. |
| G02 — Physical and published V1 behavior | Not run | No production query, publish check, full browser certification, or physical Android/iOS device test was run. The prior audit explicitly bounds its browser evidence to isolated synthetic environments. | Existing V1 release/operations owner; physical-device owner for device behavior. | Use the owning authorized release or operational workflow if a future decision requires that evidence. Not a blocker to this documentation bundle. |
| G03 — Reserved VM pilot access | Not run / blocked | No separate V2 project, disposable deployment database, or isolated Reserved VM target was available. The current workspace is V1; publishing it would cross the stated safety boundary. | V2 project owner for provisioning and approval; V2 engineering owner for the synthetic pilot. | Provision/authorize a separate V2 project and disposable database, then record process health, shared-DB, restart, publish, and connection-budget evidence. |
| G04 — Pilot sequencing conflict | Needs-human | The merged architecture says the pilot gates V2 feature implementation. The owner-confirmed scope note and `v2/README.md` say isolated V2 code can be written before the pilot, which is a pre-release gate. V2 run-control code already exists. This package cannot infer which wording the owner intended. | V2 product/architecture owner. | Clarify whether the pilot gates further feature work or only deployment/release. Preserve the existing isolated code; do not test against or publish V1. |
| G05 — Full candidate inventory and published-data staging | Excluded; resolved for this package | `docs/research-reconciliation/inventory.json` is metadata-only, has source revision `6db5dcb…`, and contains customer-source filenames and broad unrelated candidate metadata. The dated published-inventory staging JSON and boundary report are evidence inputs, not V2 source records; they were not copied. Their rows and operational details are not needed to state the V2 transfer boundary. | Research-package owner. | No action. If a future audit needs discovery metadata, produce a privacy-filtered, current-revision extract first. |
| G06 — Raw November 7 uploaded investigation | Excluded; content not archived | `attached_assets/full-debug-server-load-sync-autotrack-2026-11-07_1794060956928.md` is a production/operations investigation. Only file metadata and headings were inspected; the newer sanitized, bounded report in the V2 architecture inputs was used instead. The upload was not copied. | V1 operations/evidence owner. | Reuse a sanitized, revision-bound summary only if a future decision requires it; do not archive raw captures or production rows. |
| G07 — QC and allergen policy | Needs-human if scope expands | V1 has advisory/source-bounded QC behavior, but QC is not in the confirmed V2 first-release scope. V1's historical QC plan contains owner- and facility-specific criteria and cannot authorize V2 safety policy. | V2 product owner and qualified facility/QC policy owner. | Keep QC out of the first-release requirements unless separately approved with sources, roles, retention, and safety boundaries. |
| G08 — Task lifecycle and overlap | Verified from accessible task records, snapshot 2026-11-10 | #3907 and #3715 are merged; #3908–#3912 records report `CANCELLED` and the supplied task context calls them archived; #3913/#3914 are `PROPOSED`. Their full accessible descriptions are saved in this bundle. Hidden conversations were not accessed. | V2 task owner. | Preserve these states. Do not treat archived/cancelled proposals as requirements or recreate their tasks. |
| G09 — Local archive-link targets | Some excluded; resolved with placeholders | Selected original Markdown sources link to broader evidence, historical decisions, or task folders outside the package. The copied source text is unchanged; omitted local targets have explicit placeholders. Main conclusions are restated here and do not rely on those originals being available. | Research-package owner. | Follow the package's own reconciliation and evidence links. No action unless the target becomes material to a later decision. |
| G10 — Primary-source refresh | No new external research needed | The merged V2 architecture and archived source snapshots already include official Replit documentation fetched 2026-11-10 and browser Page Visibility guidance. The architecture also lists PostgreSQL, Node.js, transactional outbox, pool-sizing, and SSE primary references with applicability limits. | V2 architecture owner. | Revisit a specific source only if the topology, sync, or worker decision changes; no new platform research was added here. |

## Source-format and retention coverage

The relevant V2/reconciliation inputs were inventoried by extension and file
metadata before copying. The selected archive contains Markdown sources and
task-record snapshots; the Replit source captures and primary research are
Markdown text. The existing app-wide inventory also lists JSON, DOCX, PDF,
spreadsheets, images, ZIPs, code, and operational evidence. Non-text customer
workbooks and unrelated binary assets were not opened or copied. The source
inventory JSON is excluded as described in G05. No scanned PDF was selected;
no PDF/DOCX content was used to make a V2 first-release claim.

The older Full Plan (version 2026-10-08) and October 16 decomposition roadmap
remain historical inputs. Their status tables are not treated as current V1
state or V2 approval. Current V1 conclusions use the current source and focused
tests above; the V2 architecture and owner-confirmed scope note govern V2
planning, subject to the sequencing conflict in G04.
