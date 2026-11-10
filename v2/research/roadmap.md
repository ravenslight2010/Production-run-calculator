# V2 research-backed roadmap

**Purpose:** prioritize work already supported by the approved V2 scope while
keeping archived proposals, human decisions, and evidence prerequisites
separate. This is a recommendation, not implementation authorization.

## Priority 0 — Resolve the pilot gate wording

- **Outcome:** one clear rule for whether the separate-project Reserved VM
  pilot blocks further isolated feature work or only deployment/release.
- **Evidence:** the merged V2 architecture says “before V2 feature
  implementation”; the owner-confirmed scope note and V2 README say isolated
  code can be written first and the pilot is a pre-release gate.
- **Risk of waiting:** implementation sequencing may be misread as either a
  hard stop or a bypass of a deployment safety check.
- **Owner / dependency:** V2 product/architecture owner; no code or deployment
  access is needed to resolve the wording.
- **Effort / uncertainty:** low effort; intent is human-owned.
- **Acceptance:** architecture, scope note, and handoff describe the same
  boundary; the existing code-only V2 slice is not retroactively invalidated.

## Priority 1 — Continue the confirmed first-release outcomes

### Run control, stations, sync, and automatic tracking

- **Outcome:** all station work is server-authoritative and consistent across
  devices; reconnect, lost replies, and worker restarts do not lose or duplicate
  accepted progress.
- **Evidence:** V1 has extensive, station-specific contracts and tests, but the
  full V1 app-wide audit still records physical/published evidence limits.
  V2 has only a run-control foundation and architecture-level sync/worker
  contracts.
- **Risk of waiting:** V2 cannot deliver its core production workflow.
- **Owner / dependency:** V2 implementation owner; follow the clarified pilot
  boundary and implement V2-owned auth/session adapters before exposing
  protected operations.
- **Effort / uncertainty:** high; station units, shared run identity, concurrency,
  background wake, and worker failure are distinct boundaries.
- **Acceptance:** disposable V2 API/DB checks for receipts, revisions,
  concurrency, leases/fencing, wake/snapshot adoption, and no duplicate
  automatic effects; then two-session browser coverage for run/station paths,
  desktop/phone/tablet, Chromium and WebKit. Physical Android and iOS PWA
  evidence must be reported separately.

### Inventory and opening count

- **Outcome:** receiving, transfer, count, correction, and run consumption
  reconcile to an append-only V2 ledger; opening stock comes from a new
  reviewed physical count.
- **Evidence:** V1 accounting code and pure inventory math are present, but
  V1 balances/history are explicitly excluded from V2.
- **Risk of waiting:** no trustworthy V2 stock position or safe consumption.
- **Owner / dependency:** V2 inventory owner and facility count approver; build
  on the V2 command/authorization boundary, never copy V1 on-hand values.
- **Effort / uncertainty:** high; unit mapping, location/lot rules, count
  discrepancy workflow, and simultaneous corrections require transactional
  tests.
- **Acceptance:** disposable V2 tests prove idempotent ledger/on-hand parity,
  stale absolute-count conflicts, and run-consumption retry safety; an
  owner-reviewed opening-count receipt reconciles exactly before real stock
  movements begin.

### Recurring production imports

- **Outcome:** managers review source changes, explicitly apply once, and can
  inspect accepted results after reload without silent deletion or guessed
  values.
- **Evidence:** V1 supports seven distinct importer contracts; V2 architecture
  specifies staged manager confirmation and idempotent Apply, but no recurring
  V2 importer is implemented. Draft #3913 concerns setup/master-data transfer,
  not routine production imports.
- **Risk of waiting:** recipe/setup changes remain manual or are mistaken for
  already-supported V2 behavior.
- **Owner / dependency:** V2 import owner; use V2 auth/permissions, a defined
  supported-format set, synthetic fixtures, and no customer workbook copy.
- **Effort / uncertainty:** medium/high; each format has its own source,
  matching, partial failure, retry, and rollback boundaries.
- **Acceptance:** documented supported formats; preview and changed-row
  review; explicit manager Apply; persisted history/reload; safe retry after
  lost response; role denial; no deletion inferred from missing source rows.

The data-transfer and sign-in work currently sits in draft tasks #3913 and
#3914. Their task-record snapshots are included in the bundle; neither draft
is treated as accepted work.

## Priority 2 — Complete cutover controls before real use

- **Outcome:** V2 starts with approved setup and roles, fresh credentials,
  empty run history and a verified physical inventory baseline; V1 remains a
  separately restricted historical system.
- **Evidence:** the merged architecture contains a table allowlist, identity
  revalidation procedure, fresh count protocol, and a read-only V1 archive
  recommendation. No migration or cutover was run.
- **Risk of waiting:** accidental history/stock transfer, stale-session reuse,
  or an unclear historical access/retention policy.
- **Owner / dependency:** V2 owner, security owner, and facility inventory
  approver; requires a separately provisioned V2 project/database and
  approved cutover/retention decisions.
- **Effort / uncertainty:** high operational impact; exact identities, roles,
  product mappings, physical count, and retention rules need review.
- **Acceptance:** dry-run counts/conflicts against a disposable V2 DB; explicit
  carry/exclude record; new sign-in and unmapped-role denial; approved count;
  separately documented V1 read-only access and retention; no historical runs,
  V1 inventory balances, sessions, or tokens in V2.

## Keep outside the first release unless separately approved

- QC, allergens, food-safety holds, label/date-code enforcement, and Brix
  thresholds require qualified sources and owner-approved policy; V1 advisory
  behavior is not authorization for V2 rules.
- A separate V1 historical archive is recommended for cutover but has no
  approved retention period, access policy, or created archive.
- New deployable services, external database providers, native mobile apps,
  offline writes, and broad import Apply-all behavior are not approved by the
  available V2 scope.
- Do not reopen V1 backlog items solely because older Full Plan or decomposition
  snapshots still describe them as open.
