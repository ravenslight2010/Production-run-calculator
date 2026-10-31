# Branch repair claims: bounded validation

Investigation date: 2026-10-23. This is an investigation and selective repair,
**not a clean-merge recommendation, Publish approval, or production-readiness
certificate**. No production publication, production DDL, shared-database push,
external workflow trigger, branch push, or data heal was performed.

## Source and evidence boundary

- Integrated starting revision: `e424a273855e0f42eba761ae050716538e015637`,
  including the separately owned run-template timeout/isolation recovery.
- Preserved local baseline: `refs/heads/recovery-baseline-branch-claims` and
  `refs/tags/recovery-baseline-branch-claims`, both at that revision.
- Historical document tip: `486d53b43189c920a3025b3cb90aaf9543e826a2`.
  Comparison also used `51f2e804`, serial-policy revision `abcf47e1`, and
  pre-conversion schema `9723b35f5a3c343051cb96ff9dcc664ef9f4aa10`.
- The read-only GitHub main query still returned `486d53b4` during this
  investigation. There were **no hosted runs for `e424a273`**. Local checks
  below must not be presented as hosted CI results.
- Raw, bounded evidence is under `.local/task-evidence/branch-claims/`.
  It is intentionally ignored and environment-specific; this report preserves
  the conclusions, commands, revision/run identities, failures and limits.
  The final source manifest there binds the investigation's uncommitted source
  changes to the baseline; it is not a production build identity.
  Its 10-file source digest is
  `8469246c17e74b19ac34cd3d1dea257ca67b55fd8a637848b63c21f946fdeda8`.
  Documentation and memory are excluded from that digest to avoid a circular
  report hash; exact source paths and individual SHA-256 values are in the
  manifest.
- All database writes used freshly initialized private PostgreSQL clusters,
  random loopback ports, private socket directories, and disposable databases.
  Historical dependency workspaces excluded uploaded/customer assets and used
  their own frozen lockfiles with dependency lifecycle scripts disabled.
  No environment credential values were read or retained.

The uploaded DOCX's operational hypotheses were assessed independently of its
explanations. A bad explanation is not evidence that the failure is imaginary.

## Claim dispositions

### 1. Historical CI causation and stability

**Hypothesis:** three consecutive main pushes failed while PRs passed because
fake-time/in-flight flush isolation was runner-load sensitive; PRs 127/128
permanently resolved it.

**Check:** authorized, read-only, revision/run/attempt-specific GitHub API
retrieval, including failed unit-test job excerpts. The OAuth connector did
not expose a connection, but the existing authenticated GitHub CLI provided
read access; the investigation did not stop at the first access path.

| Event | Revision | Run / attempt | Observation |
|---|---|---|---|
| PR 126 head | `a9d3e733a3f93953f82e1537afe9789cc1cff5d9` | `39543856476` / 1 | CI success |
| Main push after PR 126 | `1f77fe56cb25c76208c44d52c83764720b8ed582` | `39544943331` / 1 | failure |
| Same push, second attempt | same revision | `39544943331` / 2 | failure |
| Same push, third attempt | same revision | `39544943331` / 3 | failure |
| PR 127 head | `a698e3b788350a4260d4753bfc497a0ee1a30190` | `39548874014` / 1 | CI success |
| Main push after PR 127 | `d0385e67b8bc2d336065323f75629ca752669e08` | `39549938109` / 1 | failure |
| PR 128 head | `d17dea97528264c40143624080212dc51b05898c` | `39553923649` / 1 | CI success |
| Main push after PR 128 | `486d53b43189c920a3025b3cb90aaf9543e826a2` | `39555080846` / 1 | success |

The PR-126 push's failed unit jobs were `119040876057` (attempt 1),
`119044220404` (attempt 2), and `119046198636` (attempt 3); the PR-127 push's
failed unit job was `119056577027` (attempt 1). Each reported the
same three failures in `runTemplatesRepository.test.ts`: hung delete timeout,
committed timed-out save recovery, and uncommitted timed-out save retention.
Each summary had 3 failed tests, 3270 passed, 1 skipped. **Three failed tests
are not three failed main runs.**

The bounded main-push query initially covered 2026-10-20 through 2026-10-24,
then was expanded to 2026-10-19 through 2026-10-24 (15 main push runs).
It found two failed main runs, not three distinct pushes. **Three consecutive
failed attempts after the first merge are verified**; this is a narrower,
supported interpretation of the document's “failed 3 times” wording, not three
different pushed revisions. Across these two revisions there are four failed
attempts. It found one successful post-128 main push;
no later main revision was available in this window. PR 127 alone did not
resolve the observed main failure. Earlier PR failures/cancellations also
prevent interpreting “PRs pass” as universal.

**Disposition:** three failures of the first main-push run **verified by
attempt**, but a third distinct failed main push **not established**;
runner-load causation **unverified** without
runner/load or scheduling evidence; perpetual stability **unsupported**.
The companion repair is already integrated and was not rewritten here.
Current focused client checks are reported separately below.
**Confidence:** high for identified runs and failures; limited for causation.
**Remaining evidence:** a third distinct pushed revision, if that stronger
claim is intended, and actual scheduling/load evidence for the causal claim.

### 2. Retained serial-generator CI check

**Hypothesis:** the command's old name means it performs a broken identity
conversion and blocks current CI.

**Check:** run the actual current
`pnpm --filter @workspace/db run test:serial-to-identity`, including its
import-identity-write guard, on private PostgreSQL. Also exercise the workflow's
explicit admin-URL route rather than relying only on the local-cluster fallback.
The workflow pins Node 24.21.0 and PostgreSQL 16; local verification uses that
Node, pnpm 12.8.1 and PostgreSQL 16.10. Loopback host/port and trust-only
disposable authentication differ from the pinned Alpine service image.

The first current execution passed all six tests, including actual `push`,
`push-force`, approved development serial repair, reruns, coverage of all
37 legacy generators, rows/counters/grants, and import identity writes.
The label is a compatibility name, not its present behavior.
The final explicit-admin execution also passed all six, using the workflow's
fixture role, database name, environment settings and command on a private
random loopback port (`verification-final.log`).

**Disposition:** **already protected / failure not reproduced** locally.
This does not prove a current hosted CI lane passed: none exists for the
workspace revision, and historical main had removed this lane.
**Confidence:** high for the executed fixture; no claim about unavailable
current hosted execution or exact container-image equivalence.

### 3. Historical conversion, collisions, counters and preservation

**Hypotheses:** push-first conversion cleanly reconciles legacy serial tables,
preserves generator progress and audit access, and is safe on reruns.

**Check:** `NODE_ENV=test node --test
lib/db/migrations/branch-claims.integration.test.mjs` creates separately
identified historical source/dependency workspaces and private databases.
It exercises the actual historical package wrapper, raw Drizzle separately,
and the current inactive direct helper separately. It does not modify normal
push commands.

| Variant | Observation / required interpretation |
|---|---|
| Populated legacy runs, audit rows, operational ledger | Full fixture row contents survive the historical conversion. This alone is not generator preservation. |
| Raw historical Drizzle push against the populated serial schema | Logs `relation "production_runs_id_seq" already exists` **while returning exit status 0**. This is a sequence-name SQL collision, not demonstrated row loss. |
| Actual historical `push` wrapper | Also exits 0 despite the SQL error; subsequent audit/conversion commands run. Package success is not proof that the Drizzle step succeeded. |
| Populated run generator advanced to 2000 with highest stored ID 1036 | Historical next value becomes 1037, not the preserved 2001. This rewinds issued progress; this fixture does not claim an immediate duplicate stored primary key. |
| Empty photo generator advanced to 77 | Historical next becomes 2, not 78. `MAX(id)` completely misses the advanced empty counter. |
| Ordinary empty legacy table | Historical first generated value is 2: an ID gap, not row loss. |
| Audit generator with explicit maintenance sequence grant | Replacing the generator loses that explicit grant before a later audit-protection rerun restores it. |
| Operational cursor with stored sequence 9001 | Next value is 9002. This populated case passing does not establish preservation of an independently advanced empty cursor. |
| Historical rerun after identity conversion | Does not rewind again; run next value progresses to 1038. Idempotent rerun does not repair first-conversion high-water loss. |
| Current inactive direct helper | Fixes ordinary empty first value to 1, but still rewinds the populated 2000 counter to 1037 and advanced empty 77 counter to 1. It remains unsuitable as preservation evidence. |
| New `GENERATED ALWAYS AS IDENTITY` table | Starts at 1 and has a backing sequence. New-table creation is not a legacy conversion test. |
| Current serial-preserving path | Existing current regression preserves rows, generator progress (including advanced empty), grants, operational cursor, repair reruns and rollback behavior. |

**Disposition:** the historical SQL collision and preservation defects are real;
the normal current branch avoids that conversion path. Retain the current
serial policy, repair/rollback guards, and read-only diagnostics. The misleading
high-water assertion on the inactive SQL artifact was corrected, and its
limitations documented. It was **not** attached to push/build/startup/Publish
or promoted as a supported migration. Reintroducing conversion would require
a separately approved preservation design, not copying the old wrapper.
**Confidence:** high for the disposable variants; no production inference.

### 4. Replit Publish compatibility

**Hypothesis:** package push chaining automatically executes on Replit Publish
and safely converts populated production tables.

**Check:** current package scripts, supported database/Publish guidance,
official Replit documentation search, available read-only capabilities and
the full prior identity task record (#3415).

Current normal push/push-force chain only Drizzle and audit protection.
Replit's managed Publish path computes a development-to-production schema
diff; the historical package helper is not that diff. The official guidance
describes separate dev/prod databases and managed schema handling, not proof
that a particular serial-to-identity conversion is supported.

The prior task's full record explicitly says its exact protected-main
Publish diff was **BLOCKED**, production post-conversion verification was
**NOT REACHED**, and no production change was performed. Its “MERGED” lifecycle
is not execution proof. No exact relevant SQL/rename/overwrite review was
available here either.

**Disposition:** package-chain automatic Publish claim **contradicted**;
exact populated legacy conversion compatibility **BLOCKED / unknown**.
Keep production unchanged. A future decision requires owner-controlled review
of the exact relevant Publish SQL, no overwrite/unapproved rename, preservation
of rows, generator state/ownership/grants/cursor, supported-platform evidence,
and renewed approval for any expanded or non-preserving scope. A successful
direct helper or new Import Gold table cannot substitute.
**Confidence:** high about the evidence boundary; no migration approval.

References consulted:
- https://docs.replit.com/features/data-and-storage/development-and-production
- https://docs.replit.com/features/data-and-storage/sql-database
- https://docs.replit.com/features/data-and-storage/work-with-your-data
- Repository database skill's managed Publish migration guidance.

### 5. “Identity means no separate backing sequence”

**Check:** PostgreSQL catalog joins after real disposable conversion:
`pg_get_serial_sequence`, `pg_attribute.attidentity`, `pg_depend.deptype`,
and `pg_get_expr(pg_attrdef...)`.

Converted identity has `attidentity='d'`, internal sequence dependency `i`,
and no ordinary `nextval` default expression, **but the backing sequence still
exists**. New always-identity tables also have a backing sequence.
Serial ordinarily exposes a `nextval` default and an automatically owned
sequence; identity expresses generation through column metadata/internal
ownership. Neither form eliminates the counter or makes replacement
grant/high-water mistakes impossible.

**Disposition:** explanation **contradicted**, without treating this correction
as a reason to migrate either legacy serial or current new identity tables.
**Confidence:** high, catalog-backed.

### 6. Canonical sync and station activity coexistence

**Check:** current sync integration, reset, convergence, protectRunValues,
station activity, HTTP security and brand-profile suites, plus bounded
two-client operational browser cases. The dedicated convergence runner's
isolation guard was preserved; destructive resets used only disposable data.

The initial independent API batch passed 327 tests in six suites. Its
convergence suite refused that runner (11 not executed), then passed under
`scripts/src/run-isolated-sync-convergence.sh`. These are distinct results,
not 11 passing tests inferred from a zero outer-shell exit.

Coverage includes canonical stale/blank protection, scoped date authorization,
scope/date broadcasts, reset/session fences, no-op snapshots and newer
run-value authority. Station evidence remains run-bound; Tunnel/Warehouse
activity is not inferred from counters or generic edits. Read failures return
unknown (`stationActivity: null`), not fabricated confirmation.

**Defect repaired:** a query begun before invalidation could finish afterward
and repopulate stale station evidence. The extracted bounded cache now fences
cache insertion with an invalidation generation. Focused regressions cover
1-second expiry, 256-entry eviction, scope/date/run separation, selective
invalidation, clear/reset during in-flight loads, read rejection and recovery.
The original in-flight request may finish; it cannot poison later cache reads.
Canonical document/hash, counters, accepted event semantics and station
cadence are unchanged.

A disposable route-level failure test temporarily hides only the evidence
table, verifies HTTP 200 with unknown activity and intact canonical state,
restores the table in `finally`, and verifies recovery with the same snapshot
and data. No confirmations correctly produces `{}`, not synthetic null-valued
station keys.

**Browser observations:** Chromium's desktop two-client deletion/reload and
epoch/date/no-op paths passed. WebKit deletion/reload passed. WebKit's reset
case timed out waiting for a main-frame navigation; its later wake adoption,
reload-persistence and date-scoped assertions were **NOT REACHED**. That is not
evidence that stale data was resurrected, but is not a passing reset journey.
The existing wake/update-recovery owner (#3568) owns that same boundary; this
investigation did not duplicate its app recovery changes. The authority
expansion remains owned by #3572.

**Disposition:** existing merge/reset protections verified at the targeted
server boundary; cache race **defect repaired**; WebKit wake/reset runtime
outcome **partially verified / existing-owner gap**. Confidence high for the
deterministic server/cache checks, limited for that browser wake path.

### 7. Actual rendered Home manager-attention accessibility

**Check:** the real Home header and More-menu badges, not CSS string assertions,
through the isolated `playwright.branch-claims.config.ts` selection. Count
fixtures stub only the actionable count; real account/capability and incident
fixtures use isolated APIs and unique accounts. Both supported themes are
forced through actual DOM styles.

| Surface | Chromium | WebKit |
|---|---|---|
| Desktop 1440×1000 badge contrast / identification / keyboard open-close | PASS | PASS |
| Phone 390×844, same checks | PASS | PASS |
| Tablet portrait 768×1024, same checks | PASS | PASS |
| Tablet landscape 1024×768, same checks | PASS | PASS |
| Light and dark computed small-text contrast | PASS, ≥4.5 | PASS, ≥4.5 |
| Full 1 / 42 / 123 accessible counts at all four widths | PASS | PASS |
| Staff without manager capabilities: no badge or manager menu action | PASS | PASS |

The contrast checker reads computed RGB colors, requires opaque backgrounds
and calculates relative luminance. Exact per-case ratios were not retained;
the evidence supports the threshold, not invented numeric measurements.
Accessible labels include the full count; menu decoration is aria-hidden.

**Fixture defect repaired:** the prior manager-attention spec was malformed
(missing wrapper, duplicate declarations, detached incident assertions). This
prevented trustworthy collection. It was repaired without changing the app's
badge styles or shared layout. The separately reconstructed incident
Enter/Space check failed before review/resolve. Waiting for Home's destination
focus handoff did not resolve it. Source inspection established that **new
incidents start expanded**: the fixture's first Enter collapsed the card
rather than expanding it. It now verifies initial expansion and keyboard
collapse/reopen. A cheap component regression checks that initial-state
contract. The final browser action replay after that correction was **NOT RUN**;
no review/Space-resolution browser PASS is claimed or included above.

The two-client operational browser selection used desktop contexts. Phone and
tablet rows above establish rendered badge/navigation behavior, not separate
two-client wake/reset evidence at every viewport. That bounded operational
selection is a limitation, not physical-device or general-responsive proof.
Physical Android Chrome, physical iOS Safari/PWA: **NOT RUN**, no authorized
device access. Native mobile: **NOT APPLICABLE**, web/PWA task.
General responsive repairs remain owned by #3596.

**Disposition:** rendered badge applicability **verified**; malformed test
fixture **repaired**. No general contrast/accessibility certification.

### 8. “Everything else is additive and merges cleanly”

**Check:** historical/current tree inventories and
`git merge-tree --write-tree refs/heads/recovery-baseline-branch-claims
486d53b4`, without merging/resetting the working branch.

The dry tree merge returned status 1 with content conflicts in
`runTemplatesRepository.ts` and its test, which have already received the
selective companion recovery. The current baseline and historical main differ
in 1,027 paths. Shared material surfaces include Home, sync, DB schema/package
policy, test infrastructure, CI and generated/API contracts; “new work”
does not make those shared-file changes disjoint.

Current differences also intentionally preserve serial generators, sequence
diagnostics, token-promotion removal, station evidence, newer permission/scope
fences, CI provenance/timeouts and newer component ownership. The targeted
security and brand-profile checks support preserving behavior rather than
blindly copying historical files. The recovery auditor's documented Home
memo-boundary string difference is not proof of missing functionality.

**Disposition:** blanket textual clean-merge claim **contradicted**; blanket
semantic additivity **unsupported**. No real merge/reset was performed.
**Confidence:** high for the dry conflicts and source inventory; no claim
that a conflict-free path would prove semantic preservation.

## Verification and full failure ledger

### Successful and independently bounded evidence

- `serial-current.log`: all six current serial/identity-write guard tests pass
  using a private PostgreSQL fallback cluster.
- `convergence.log`: isolated canonical convergence runner reports passed.
- `api-targeted.log`: six targeted suites, 327 passed; convergence guard
  refused the wrong runner, handled separately above.
- `final-targeted.log`: after the cache extraction, 330 tests passed; one new
  fixture assertion incorrectly expected null-valued station keys rather than
  the documented empty evidence object. That test assertion was corrected.
- `typecheck.log`: **PASS**, supported root `pnpm run typecheck`, including
  library declarations, API core/routes, client, generated contracts and
  existing source/budget checks. No compiler error was waived.
- `verification-final.log`: **PASS**, all six serial checks through the
  explicit CI-shaped admin route; all 199 tests in sync/reset/cache suites;
  all 67 tests in template timeout, request timeout, Home accessibility
  contracts and Home/factory sync suites. These overlap earlier selections
  and are not summed into an inflated unique test total. Recovery audit
  remains 9 PASS, 1 intentional difference, 0 missing.
- `historical-db-verified.log`: **PASS**, actual historical Drizzle/package
  chain, row/counter/grant/cursor/catalog/rerun characterization, new identity
  creation, and separately the current inactive direct helper.
- `fixture-final-check.log`: the corrected incident initial-state component
  regression **PASS**; its subsequent broad syntax scan found the unrelated
  pre-existing merge fixture splice, repaired as described in the ledger.
- `fixture-source-verified.log`: all browser specs pass syntax validation and
  the repaired browser specs/config pass focused semantic checking. The final
  whitespace-only cleanup does not invalidate those semantic results.
- `recovery-audit-retry.log`: 9 PASS, 1 documented intentional difference,
  0 missing. The audit is a bounded manifest, not exhaustive proof.
- `browser-matrix.log`, `browser-remaining.log`: preserve the initial pass and
  only uncompleted/failed follow-up selections, not a fresh broad release run.
- `isolated-signin.jpg`: the private built app renders its signed-out landing
  page. Its unauthenticated 401s are expected access denials, not signed-in
  badge evidence.

### Failures, handling, accountability and limits

| Failure / gap | Handling and disposition |
|---|---|
| System pnpm recursively bootstrapped before project checks | Provisioned the exact pinned native manager in ignored runtime state. Audit retry passed; no engine/lockfile relaxation. |
| OAuth connector supplied no usable connection | Used existing authorized read-only CLI access. No new secrets or repository permissions requested. |
| CLI initially refused ANSI job-log output | Used its explicit safe-output option, removed escape sequences and retained bounded failure excerpts. |
| Archived package without workspace catalogs attempted an unrelated install | Failed before the experiment; retained logs. Replaced symlinked/partial fixtures with source-only historical workspaces and their own frozen manifests/lockfiles. |
| Native pnpm rejected a symlinked hoist directory | Stopped using shared node_modules symlinks; historical fixtures install their own pinned dependencies with hooks disabled. |
| Partial archive omitted frozen-lockfile importers | Included all source workspace/importer directories, without customer uploads. No lockfile regeneration or security-policy bypass. |
| Historical empty-table expectation incorrectly predicted 1 | Actual historical result is 2. Corrected the characterization and kept it distinct from the current helper's empty-first-value fix. |
| Combined API runner omitted convergence isolation markers | Guard correctly blocked it; used the existing dedicated isolated runner, which passed. |
| New route test expected `{freezeTunnel:null,warehouse:null}` | Actual no-evidence contract is `{}`. Corrected only that test expectation; failure path already returned unknown and preserved the canonical snapshot. |
| Cache invalidation can race an in-flight query | Repaired here with generation fencing and focused regression coverage, without changing production math or canonical authority. |
| Malformed existing manager-attention spec | Repaired collection and orphaned/duplicated fixture structure here; no broad UI restoration. |
| Initial browser command hit its outer 300-second budget | Retained completed results and failure traces; continued only missing/failed selections. Cleanup remained isolated. No unfinished test was relabeled pass. |
| Incident keyboard fixture failed after focus-handoff waits | New incidents intentionally begin expanded: Enter collapsed them. Corrected the fixture to verify initial state and collapse/reopen; added a cheap component regression. Review/Space-resolution browser assertions were not reached before that correction and were not replayed afterward. No application keyboard defect was established. |
| New component assertion over-specified the status text in a button name | Match the actual incident title independently of status casing/spacing; retain the explicit expanded/collapse/reopen assertions. |
| Broad spec syntax scan found pre-existing spliced merge-alias tests | Recovered missing test boundaries/assertions from the last intact parent, removed orphan statements and retained the newer scoped restore helper and restore assertions. Application merge behavior was not changed. This is collection/source verification, not a newly executed merge UI journey. |
| Focused semantic fixture check found a copied SQL block and a const reassignment | Restored the password-reset verification SELECT from its intact parent (rather than an unrelated alias INSERT), the mutable recipe dialog, and category-scoped alias assertion. These are test-only repairs; no password-reset or merge application policy changed. |
| WebKit reset waits for navigation and times out | Later assertions not reached. Existing owner #3568: determine whether canonical wake/reset adoption fails or the navigation-only expectation is too narrow; fix there and replay the bounded case. #3572 retains broader authority scope. |
| Exact protected-main Replit Publish diff unavailable | Genuine platform/approval boundary; owner must expose the exact supported diff before any future rollout decision. No production mutation attempted. |
| Initially conflated a run's latest job list with attempt 1 | Corrected by fetching explicit attempt metadata and job lists: three failed attempts of the first push are confirmed. The third distinct main push and runner-load telemetry remain unestablished. |
| Inspection command used an invalid module URL / continuation request identifier | Corrected inspection inputs; these failed before the requested measurement/continuation and were not counted as app failures or passing checks. |
| Final whitespace check found an extra EOF blank line in the recovered fixture | Removed that blank line and verified `git diff --check` separately; no semantic test rerun was necessary. |
| Original companion's detailed repeat logs not present in this fork | Its full task record and integrated source were checked; current focused tests are separate evidence, not a retroactive claim about those missing logs. |
| Physical device access unavailable | Android/iOS/PWA physical checks not run; emulation is labeled explicitly. |

Expected fixture auth denials, deliberately broken evidence reads, and
negative-test automatic-tracking failures are not production incidents. They
remain in local logs for context rather than being silently converted into
successful operational paths.
Credential-bearing generated trace archives were removed after retaining
sanitized summaries, error contexts and synthetic-fixture screenshots; raw
traces are not deliverable operational evidence.

## Recommendation and remaining ownership

1. Keep the integrated selective run-template repair. Do not copy historical
   repository files wholesale or infer permanent CI stability.
2. Keep serial-preserving legacy schema/push/repair protections and the
   read-only generator diagnostic. Keep new Import Gold always-identity tables
   as new tables; they do not authorize legacy conversion.
3. Keep current auth/security, scope/date/reset/blank merge protections,
   station evidence, brand-profile behavior and CI hardening. Retain the
   narrowly repaired cache fence and now-collectable accessibility fixtures.
4. Do not recover the old identity push chain. Its actual SQL error, counter
   rewinds, empty-first-value gap and grant loss are stronger evidence against
   blind recovery than the document's argument is for it.
5. Leave the exact Publish decision unknown until its owner-controlled,
   supported-platform diff and preservation evidence are available. No live
   identity rollout is assumed or proposed by this report.
6. Resolve the WebKit wake/reset gap through existing owner #3568; do not
   duplicate its update/recovery repair. #3572 owns broader server authority,
   #3571 shared-record cache migration, and #3596 general responsive repairs.
   #3491's Docker performance outcome is already merged and was not rewritten.

These are selective dispositions, not a blanket clean-merge or release GO.
