# Audited inventory accounting — bounded verification

**Status: bounded verification complete on disposable data.**
No production accounting, publication or readiness certification is claimed.

## Provenance and execution

- Base revision: `9eca009150d0bc1cc2f9d4131fa59b1c2b3d5bc2`; measured working-tree
  patch identity at the initial inventory-suite start:
  `ad9fbb3f921c43254802fed14e5a77c4ca9a61e5c11cd83879c8eb182e88df65`.
- Rebased test source revision: `d3ee9007b2491be49a104a2c3e893b1b6e3ef35a`;
  measured working-tree patch identity for post-rebase checks:
  `7e574ebcc018204acf42613c3b86cd4191bb8661a421de348e84d6e83d6765fd`.
  Per-file hashes below bind the tested sources and regenerated API outputs.
- Date: 2026-10-22 UTC. Local Linux x86_64; pinned Node `24.21.0` through
  the installed Nix runtime using the task evidence runner's direct-pinned-node
  mode. The ordinary release wrapper initially failed before tests because its
  Node options requested both incompatible system/OpenSSL CA modes; no test was
  counted from that attempt.
- All database execution used a newly initialized private PostgreSQL 16 cluster.
  Each existing integration fixture then created, pushed the canonical schema to,
  and dropped its own disposable database. No inherited database credentials or
  production rows were used. Cluster shutdown was part of the runner.
- Data: synthetic fixtures. Logs omit connection strings; synthetic audit actors
  are not real staff identities. No cookies, headers, secrets or source workbook
  contents are retained in this summary.
- Full local command/result records, pre-extension matrix and sanitized logs:
  `.local/tasks/evidence/verify-audited-inventory-accounting/` (ignored local
  evidence, not a shared durable artifact). This repository report is the sanitized
  handoff; it does not pretend the ignored logs travel with a merge.
- The task made a bounded server accounting repair and extended existing suites;
  it did not replace the accounting implementation or remove existing assertions.

### Source identity for the extended checks

The hashes below identify the measured implementation, tests, and regenerated
contracts; the initial and rebased test revisions are recorded above.

| File | SHA-256 |
|---|---|
| `lib/inventory-math/src/index.test.ts` | `f26ad7130875fb8ffaf3fd06bf80d40de293f4aca328aaf639d8de7050453cdc` |
| `artifacts/api-server/src/lib/preparedMixHandoff.ts` | `743dff5bcbf71a9b1e835863a0d055f6064a161c53a58ed1199c9e96c3e2fb2b` |
| `artifacts/api-server/src/lib/preparedMixHandoff.test.ts` | `9af29b1552a5f570d0dd0a3090b492685591a7c361d170218d45f257f3bfd698` |
| `artifacts/api-server/src/routes/inventory.ts` | `7a086176d4685d58e85a0a9815648203204c3711f80795012e51e4d682e3412c` |
| `artifacts/api-server/src/routes/inventory.integration.test.ts` | `f676ac3ea11f1d81cd456abf0405b640927c71843901894426a42ccc498477f7` |
| `artifacts/api-server/src/routes/sync.integration.test.ts` | `3b84b5b48ff84561f8d4391b7bf5df7d3a9465116887bae7409216c2b0d9defb` |
| `artifacts/api-server/src/routes/freezerSurplus.integration.test.ts` | `749866661cc6d9f0b5d6f9068acd9ac350f10b574c3b140105f950a1feaacd0e` |
| `lib/api-spec/openapi.yaml` (403/409 contract) | `f8d4dd3af44771e886314aa128eb3b2eb9e12b06a22365a384ce6ab9935c51b1` |
| `lib/api-client-react/src/generated/api.schemas.ts` | `461cbf9e14f9df70486cf39c1fe4bb8295f04714b0d00a97d65d10769b530122` |
| `lib/api-client-react/src/generated/api.ts` | `04cb639f4ac403b90689f6264477f4c2fbc1995570f31abd241290d7ad577cdb` |
| `lib/api-zod/src/generated/api.ts` | `64b8ee61723d1c590a40c734730b41d7c2932841580681fc5d51dc0a09d8b2e7` |
| `lib/api-zod/src/generated/types/index.ts` | `46e04754bc80d71abf02df006f2f072bb2a37e63f5b1e2bd193d3678b698aa35` |
| `lib/api-zod/src/generated/types/consumeInventoryDayStart409.ts` | `e98548bd09416871294994f88ffb2e7942a2479c86d59cf9259d678b36025915` |

## Commands and results

Final commands ran via `.local/tasks/evidence/verify-audited-inventory-accounting/run-checks.sh`
with `DIRECT_PINNED_NODE=1`, an isolated PostgreSQL 16 cluster, and synthetic
fixtures. Exit status/counts, not source presence, determine execution labels.

| Check | Exact command after the prefix | Result |
|---|---|---|
| Prep helper and persistence boundary, post-rebase | `CHECK_SET=prep-repair` | PASS; 14 selected, 60 deliberately skipped; UTC 20:04:50. |
| Full pure inventory math, post-rebase | `pnpm --filter @workspace/inventory-math run test` | PASS; 96/96, 2 files; UTC 20:04:52. |
| Full selected physical inventory events, post-rebase | `pnpm --filter @workspace/api-server exec vitest run src/routes/inventoryLogic.test.ts src/routes/inventory.integration.test.ts src/routes/freezerSurplus.integration.test.ts` | PASS; 93/93, 3 files; UTC 20:05:15; real disposable-DB integration tests executed. |
| Prepared-mix completed-run correction, post-rebase | `CHECK_SET=prep-corrections` (`--testNamePattern=prepared-mix run decrease`) | PASS; 1 selected, 172 deliberately skipped; UTC 20:07:46. The selected test covers decrease, increase, zero, retries, and prepared-stock-only correction. |
| Full completed-run correction group, post-rebase | `CHECK_SET=corrections` (`--testNamePattern=completed-run inventory corrections from sync writes`) | PASS; 6 selected, 167 deliberately skipped; UTC 20:08:26. Unselected tests are not passes. |
| Sync date/intent groups, post-rebase | `CHECK_SET=sync-date-intent` (`/sync/today` date keying, day-break reset fencing, and operational-intent finalization) | PASS; 12 selected, 161 deliberately skipped; UTC 20:12:08. |
| Existing client warning/access regressions | `pnpm --filter @workspace/run-calculator exec vitest run src/warehouseCoverage.test.ts src/inventoryShared.transferWarnings.test.ts src/components/FreezerSurplusPanel.access.test.tsx` | PASS; 14 tests, 3 files in the earlier baseline run; client sources were unchanged by this task. |
| API route types | `pnpm --filter @workspace/api-server run typecheck:routes` | PASS; exit 0 after prep source/test changes. |
| Full workspace types | `env CI=true pnpm run typecheck` | PASS; exit 0 on post-rebase source; UTC 20:07:34. |
| Day-start API contract/codegen | `pnpm --filter @workspace/api-spec run generate`; `pnpm run check:api-generated` | PASS; generated 403/409 response types; final generated Zod suite 6/6. |
| Workspace typecheck after post-rebase codegen | `env CI=true pnpm run typecheck` | PASS; exit 0; also rerun in the post-rebase final check above. |
| API workflow restart | `artifacts/api-server: API Server` | PASS; listening on port 8080 and startup initialization complete at UTC 15:31:12. |

The sync correction group is specifically the completed-run inventory-correction
path, not a claim about every sync/date/reset journey. Its existing rollback
failpoint and the added prepared-mix correction scenario ran against disposable
database fixtures both before and after the rebase. The sync date/intent groups
also ran after the rebase (12 selected tests); the post-rebase inventory suite
reran the independent-date and yesterday-to-today day-start scenarios. The
prep-repair selection includes the new pure handoff tests as well as day-start
persistence cases; the full physical suite then ran without filtering any of its
selected files.

## Effective event authority and persisted boundaries

| Physical event | Authority and identity | Actual persisted effect | Coverage |
|---|---|---|---|
| Initial final consumption | Canonical saved run, scoped run ID; client lines ignored | `inventory_consumed_runs` baseline, onsite lot drawdown, `consume` ledger rows in one transaction | Existing below/above plan, absent/initial-zero fallback; concurrent same-run retry; capped stock; client inflation/unrelated keys ignored |
| Saved completed-run correction | Serialized canonical sync transaction | Original item-ID baseline plus run ledger determines only the remaining delta; stock and saved snapshot roll back together | Existing increase/decrease/explicit-zero, repeat save, packaging disable/restore, merged baselines, legacy missing baseline and failpoint checks |
| Product-mix day start | Scoped `day-start:date`, requested saved date only | Fresh component lines, mix carry/surplus, stock and ledger commit atomically | Existing concurrency/rollback/scope; extended fresh/half/full carry and yesterday/today replay |
| Ingredient-linked prep day start | Scoped day-start, canonical run ID, saved recipe fields, and date/run idempotency claims | Fresh raw component lines, prepared-stock receipt, and immutable versioned run handoff in the same transaction | PASS: fresh/partial/full carry, yesterday/today retry, missing-unit ambiguity rollback; raw stock is unchanged by completion and corrections |
| Daily supplies | Same day-start transaction | Fixed tape/glue/ink lines, matching onsite stock only | Existing all-three quantity/concurrent/rollback assertions; extended independent dates and sandbox tape claim |
| Finished-case creation and reuse | Dated surplus lot, run allocation, scoped event UUID for adjustments | Finished-case asset + freezer lot + movement ledger; no raw ingredient charge | Existing multi-lot allocation/replacement/release/retry, over-allocation, started-run restriction, damage/return/correction bounds, actor and manager audit; extended raw-ingredient sentinel |
| Manual inventory adjustment | Existing inventory-manager route | Onsite bounded positive/negative stock movement with ledger | Existing tests executed; **not** a dedicated waste/spoilage classification |

The finished-case adjustment UI already exists in `FreezerSurplusPanel.tsx`,
including manager access guards. It was not rebuilt. Its immutable adjustment
history is manager-only; general signed-in stock reads remain available.

## Packaging E1–E7: formula → mode → event → persisted stock

Let `C = casesNeeded`, `P = C * pizzasPerCase`, `L = casesPerLayer`,
`S = casesPerSkid`, `Z = cartonSize`, `K = cartonsPerCase`.
All run lines below flow through canonical `/inventory/consume` → scoped run claim
and baseline → locked eligible lots → `consume` ledger rows.

| Material / stable key | Released planned formula and mode | Pure assertions | Persistence assertions |
|---|---|---|---|
| Circles `packaging:circles:{selection}` | `P`, selected non-`none`; cartoned/yes/labeled | Existing full cartoned/labeled tests | Every packaging matrix row; initial actual below/above/zero/absent |
| Shippers `packaging:shippers:{selection}` | `C`, selected non-`none`; cartoned/yes only | Existing full suite and labeled exclusions | Cartoned/yes draw; labeled/no/n-a no draw |
| E1 cartons `packaging:cartons:cases` | `ceil(P/(Z*K))`, `K>0`, default/minimum `Z=1`; cartoned/yes only | Existing double; added single/double/triple, missing denominator | All three sizes; ledger/stock and retry |
| E2 slip sheets `packaging:slip-sheets:count` | `ceil(C/L)` for `yes`, `L>0`; cartoned/yes/labeled | Existing cartoned; added labeled and invalid denominator | All enabled modes, exempt modes, scaled run lines |
| E3 grip sheets `packaging:grip-sheets:count` | Every other: `ceil((S/L)/2)*ceil(C/S)`; 3rd/5th: `2*ceil(C/S)`; none: omitted | Both patterns retained; added labeled/invalid | Both patterns/none across enabled modes; parity/retry |
| E4 top `packaging:labels-top:rolls` | `ceil(P/topCapacity)` when top/both selected | Existing top/bottom/both and shared-capacity fallback | Independent top capacity and top/both draws; omitted bottom-only |
| E4 bottom `packaging:labels-bottom:rolls` | `ceil(P/bottomCapacity)` when bottom/both selected | Same; nonpositive capacity omitted | Independent bottom capacity and bottom/both draws; omitted top-only |
| E5 pallets `packaging:pallets:count` | `ceil(C/S)` for `S>0`; cartoned/yes/labeled | Existing full/labeled assertions | Enabled modes and no/n-a absence; post-scale fractional quantities retained |
| E6 shipper labels `packaging:shipper-labels:count` | `C`; cartoned/yes only | Existing full/exempt/labeled tests | All mode boundaries |
| E7 tape `packaging:tape:count` | Fixed `4` per scoped requested day-start claim | Existing daily-rate assertion | Concurrent day start, rollback/retry, two dates, sandbox |
| E7 glue `packaging:glue:count` | Fixed `0.286` per claim | Existing daily-rate assertion | Existing same-date DB quantities, repeat-event suppression |
| E7 ink `packaging:ink:count` | Fixed `0.078` per claim | Existing daily-rate assertion | Existing same-date DB quantities, repeat-event suppression |

Each extended run matrix case seeds every run packaging item, onsite + offsite +
freezer stock and a same-key sandbox item. It asserts every enabled/disabled
material's exact persisted quantity, ledger rows and unchanged excluded stock.
Ten rows cover cartoned/yes, labeled top/bottom/both, no/n-a, carton 1/2/3,
both grip patterns/none, and actual-case scales 0.5/1.5.

**Rounding limitation:** initial actual cases scale the already-rounded planned
line by `actualCases/C`, rounded to 3 decimals. They do not recompute each physical
carton/roll/pallet ceiling. This can yield fractional packaging quantities.
Assertions preserve that released behavior; they do not endorse a new physical
rounding policy. Missing selections/denominators omit lines rather than inventing
materials. No rounding/fallback changes were made.

**Material-use limitation:** supported/configurable is not evidence of current
factory usage. The retained shipping workbook and source/tests establish options,
not which materials the owner uses today. Actual production usage remains
MISSING/unknown pending the owner's business confirmation, not “unused/won't-do.”
No bags or arbitrary daily-supply configuration is claimed. The three daily
rates are constants; only matching tracked stock is deducted.

## Conversion and date boundaries

- Existing pure drawdown test converts 40 production units with factor 20 into
  2 inventory units.
- Added real resolver tests cover linked factor 20, null, zero and negative.
  Invalid/missing linked factors yield no drawdown and empty baseline, not guessed
  conversions. Positive linked movement identifies its stock lot.
- Unlinked canonical keys with null factor intentionally retain legacy factor one
  (40 production units → 40 stock units, legacy null lot ID). An unlinked explicit
  factor is not a confirmed link and is excluded. This asymmetry is compatibility,
  not a generic weight-conversion rule.
- Prepared-mix handoffs preserve positive, unambiguous batch-pound mappings.
  When one ingredient appears in applicator slots with conflicting batch sizes,
  day start returns HTTP 409 with an explicit configuration error and writes a
  structured warning; the transaction rolls back. It does not guess a conversion.
- Same-key sandbox stock never satisfies a live event. The existing Warehouse
  `conversion` status and Inventory “Conversion needed”/“Confirm the production
  conversion on a linked product” UI explain unresolved linked conversions.
  Existing warning unit tests passed. The prep ambiguity diagnostic is API/log
  level only; no UI was changed. Soft readiness remains unchanged.
- Date fixture uses two adjacent synthetic production dates. Yesterday's entered
  50 fresh mix pounds creates carry; today's `amountActualMade` is **explicitly
  reset by the fixture** to unspecified, so only fresh need after carry is charged.
  Both accepted claims are retried, including yesterday after today. Ledger,
  stock and surplus stay unchanged on retries. Sandbox accepts its own same-date
  claim independently without affecting live stock.
- Prep-specific date tests carry prepared stock from yesterday to today, retry
  both dated claims, and confirm the raw component is charged only at prep time.
- This does not prove automatic rollover clears every stale global fresh-made
  value, historical unclaimed dates are rejected, staff date authority changes,
  or every reset/startup/offline journey. No sync/reset code was changed.

## Failure ledger and policy decisions

| ID | Result / evidence | Resolution, accountable owner and next action |
|---|---|---|
| F1 stale plan claims | Contradicted: “direct scaling not located,” missing freezer parity/returns/final corrections, generic labels key and daily reset deduction | Corrected in both owned inventory plans using current test/source evidence; older proposals are explicitly historical. |
| F2 added carton oracle | Initial extension expected 14 instead of `ceil(26/2)=13`; pure and one persistence case failed | Resolved; final pure 96/96 and all ten packaging persistence rows passed. Fixture repaired, not production math. Pure oracle uses 13; persistence uses 14 whole planned cases and whole actual counts. |
| F3 prep-mix day-start input | Initially reproduced: fresh/partial prep cases left raw stock unchanged because the planner did not receive run ingredient inputs. | Resolved with the owner-approved rule: raw ingredients are charged when prep is made; later production consumes prepared stock. Immutable per-run handoffs preserve corrections/retries without a second raw charge. Prep helper + DB selection 14/14; full physical API suite 93/93; sync correction group 6/6. No schema/data heal/production write. |
| F4 production material list | **MISSING business evidence**, not a test pass or owner-approved exclusion | Factory owner: confirm current material/mode usage. Assigned agent: retain unknowns until confirmed; all currently supported material paths are mapped regardless. |
| F5 first prep fixture | Initial prep fixture also omitted actual applicator usage | Corrected to valid saved applicator inputs before dedicated reproduction; the original accounting failure was real, not fixture-only. The final repaired cases pass. |
| F6 runtime acquisition | The ordinary wrapper failed before Vitest because incompatible Node system/OpenSSL CA options were both enabled | Bypassed only the broken wrapper invocation by using the already-installed pinned Node 24.21.0 through the task evidence runner's direct mode. Final tests executed; no CA/TLS/version guard was altered. |
| F7 freezer fixture interaction | Added ingredient sentinel caused a first-live-lot fixture selector to modify raw stock, not finished stock; damage returned 201 instead of expected 409 | Resolved selector by finished item key/ID, preserving rollback assertions. Focused freezer 10/10 passed. No production defect or repair inferred. |
| F8 generated API drift after rebase | Completion validation found generated client output stale after upstream OpenAPI changes | Resolved by rerunning the repository generator, `pnpm run check:api-generated`, and the full workspace typecheck; post-rebase checks pass. |

No unresolved implementation or test failure remains in this bounded verification.
The prep boundary is tested with a same-day completion/correction path and dated
carry/retry path. The API reports ambiguous source batch units and rolls back the
event; it does not expose a new browser banner or alter the existing best-effort
day-start UI call.

Dedicated waste/spoilage events, stoppage partial-consumption events, ingredient
returns and changed rounding/fallback rules remain policy-gated, out of scope.
Recorded waste pounds and generic negative manual adjustments do not implement
these events. These are separate from existing finished-case damage/returns.

## Compatibility and authority applicability

| Surface | Result / reason |
|---|---|
| Desktop Chromium/Chrome, phone Chromium, tablet portrait/landscape Chromium | N/A: no UI changed; API and database diagnostics were verified directly |
| Desktop/phone/tablet portrait/landscape WebKit/Safari emulation | N/A unchanged UI; not run, not passed |
| Physical Android Chrome, iOS Safari/PWA | NOT RUN; not implied by unit tests or emulation; physical-device-only work not required here |
| Native mobile | N/A web-only product |
| OpenAPI/codegen | Updated for day-start 403/409 responses; regenerated clients and validators; `check:api-generated` passed |
| Workflow restart/preview | API server restarted and reached ready before the rebase; post-rebase changes were regenerated API clients only. The frontend/manager UI was not changed or browser-tested |
| Production/release gates | N/A explicitly excluded; no publishing, production writes or readiness decision |
