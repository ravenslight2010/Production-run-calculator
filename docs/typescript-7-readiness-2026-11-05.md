# TypeScript 7.1 readiness reassessment

| Evidence field | Value |
|---|---|
| Research date and time | 2026-11-05 04:59:49 UTC |
| Environment | Local Replit workspace; Linux x64; Node `v24.22.1`; pnpm `12.8.1` |
| Git revision reviewed | `d58368fd3cf947e3bbedad1045eef4429ab99da6` |
| Canonical comparison source-bundle SHA-256 | `03f620c3e1f0d462b072785f3c8e5b90e70dc1cf18314a90cc6655ae43aa7500` |
| `pnpm-lock.yaml` SHA-256 | `d103dfa4b08910fa7b095739c62ada16acc3af7b840238fe04df288c658c9d83` |

This is a development-workspace assessment bound to the revision and comparison source
bundle above. It uses public upstream package metadata and repository evidence; it contains
no production or customer data.

## Decision

**NO-GO for replacing TypeScript 6.0.3 with TypeScript 7.1. Keep TypeScript 6.0.3
authoritative.** Keep the existing TypeScript 7.0.2 CLI comparison as advisory only. This is
a readiness decision, not a finding that TypeScript 7.1 is incompatible.

No compiler dependency, lockfile, editor SDK, release gate, or authority was changed. No
beta, nightly, or unstable API was installed or used for migration work.

The blockers are concrete:

1. Microsoft still lists TypeScript 7.1 as a beta, and npm still tags `7.0.2` as the latest
   stable compiler. The final 7.1 package and documentation are not published.
2. The official API-status discussion says some TypeScript 6 utility/program/checker APIs
   are still being mapped, and the complete migration documentation is expected with stable
   7.1. The current compiler API wiki still says it covers TypeScript 6 and earlier.
3. The latest TypeDoc package declares TypeScript peers only through `6.0.x`; the published
   TypeDoc/plugin/Orval graph therefore does not establish a peer-clean TypeScript 7.1
   toolchain.
4. The retained TypeScript 7.0.2 compiler comparison and declaration classifications have
   different source identities. There is no current-revision TypeScript 7.1 compiler or
   declaration evidence.

## Stable release and API evidence

Checked on 2026-11-05:

- Microsoft's [release list](https://github.com/microsoft/TypeScript/releases) shows
  TypeScript 7.1 Beta as a pre-release; TypeScript 7.0.2 is the latest stable release.
- npm's [TypeScript dist-tags](https://registry.npmjs.org/-/package/typescript/dist-tags)
  report `latest=7.0.2`, `beta=7.1.0-beta`, and `next=7.1.0-dev.20261104.1`.
- The beta's [package metadata](https://registry.npmjs.org/typescript/7.1.0-beta) has
  exports including `typescript/sync`, `typescript/async`, `typescript/ast`,
  `typescript/fs`, and `typescript/path`. These are beta exports and are not evidence of
  final stable exports or behavior.
- Microsoft's [API status discussion](https://github.com/microsoft/TypeScript/issues/64709)
  says watch/incremental/solution-builder APIs will not be stable in 7.1, notes missing
  utility and program/checker APIs, and says final API documentation is planned for stable
  release.
- Microsoft's [Compiler API wiki](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)
  explicitly warns that it describes TypeScript 6.0 and earlier and that TypeScript 7.1
  will have a different API.
- The [7.1 iteration plan](https://github.com/microsoft/TypeScript/issues/63703) lists
  2026-11-24 as a planned stable-release date. A plan is not a published release.

Therefore no stable replacement mapping can be claimed today. The safe disposition for
every current consumer is to keep it behind the exact TypeScript 6.0.3 boundary:

| Current source module | TypeScript API operations used | Disposition |
|---|---|---|
| `scripts/src/check-evaluation-report-retention.mts` | Parse source, traverse AST, inspect call and binding nodes | Retain on TypeScript 6.0.3 |
| `scripts/src/compare-declaration-contracts.mts` | Scanner, source parsing, AST inspection, import preprocessing, module resolution | Retain on TypeScript 6.0.3 |
| `artifacts/run-calculator/e2e/validate-browser-spec-syntax.ts` | Parse files, traverse syntax, format diagnostics, use compiler filesystem APIs | Retain on TypeScript 6.0.3 |
| `artifacts/run-calculator/scripts/check-vite-config-loading.mjs` | `preProcessFile` import discovery | Retain on TypeScript 6.0.3 |
| `artifacts/run-calculator/scripts/check-as-any-budget.mjs` | Parse and traverse AST; format diagnostic messages | Retain on TypeScript 6.0.3 |
| `artifacts/run-calculator/scripts/check-home-deferred-boundary.mjs` | Parse and traverse imports, exports, and syntax nodes | Retain on TypeScript 6.0.3 |
| `artifacts/api-server/src/lib/sharedDiagnosticPersistence.architecture.test.ts` | Parse and traverse functions, calls, bindings, and property nodes | Retain on TypeScript 6.0.3 |
| `artifacts/run-calculator/src/homeDayOverlayQueue.test.ts` | Parse/traverse AST and call `transpileModule` | Retain on TypeScript 6.0.3 |
| `artifacts/run-calculator/src/applyCaseUpdateChoices.web.test.ts` | Parse TSX, traverse AST, and call `transpileModule` | Retain on TypeScript 6.0.3 |
| `artifacts/run-calculator/src/blankRunValueSync.test.ts` | Parse and inspect literal AST nodes and syntax kinds | Retain on TypeScript 6.0.3 |
| `artifacts/run-calculator/src/freezerDomainIsolation.test.ts` | Parse TSX and traverse/inspect AST nodes | Retain on TypeScript 6.0.3 |
| `artifacts/run-calculator/src/runValueStampGuard.test.ts` | Parse TSX and inspect functions, accessors, imports, and calls | Retain on TypeScript 6.0.3 |
| `artifacts/run-calculator/src/e2eIsolation.test.ts` | Parse source and inspect declarations, imports, calls, and type nodes | Retain on TypeScript 6.0.3 |
| `artifacts/run-calculator/src/contexts/__tests__/useLiveRun-allowed-callers.test.ts` | Parse source and inspect imports, calls, and syntax kinds | Retain on TypeScript 6.0.3 |

This maps the current consumers and their operations; it does not claim that stable 7.1
exports can replace them. In particular, do not infer a replacement for AST traversal,
`preProcessFile`, module resolution, diagnostics, or `transpileModule` from the beta's
export names alone.

## TypeDoc, plugins, Orval, and strict peers

Published registry metadata checked on 2026-11-05:

| Package | Latest metadata reviewed | Relevant peer declaration |
|---|---|---|
| TypeDoc | `0.28.20` | `typescript` through `6.0.x` only |
| `typedoc-plugin-markdown` | `4.14.1` | TypeDoc `0.28.x` |
| `typedoc-plugin-coverage` | `4.0.3` | TypeDoc `0.28.x` |
| Orval | `8.46.0` | Optional TypeDoc `^0.28.19` and Markdown plugin `^4.10.0`; no direct TypeScript peer |

The checked-in lockfile currently binds Orval `8.43.0`, TypeDoc `0.28.20`, Markdown plugin
`4.14.0`, and coverage plugin `4.0.3` to TypeScript `6.0.3`. Updating Orval alone does not
remove TypeDoc's TypeScript peer restriction. On current published metadata, the graph is
**not peer-clean for TypeScript 7.1**.

A disposable strict-peer install and TypeDoc/plugin/Orval generation/runtime smokes were
**not run**: there is no stable TypeScript 7.1 candidate to test, and testing a beta would
not satisfy this task's stable-release gate. The TypeDoc peer declaration already blocks
the requested peer-clean result. This is a blocked prerequisite, not a runtime
incompatibility finding. Do not treat a frozen install's exit status alone as peer evidence;
the repository's pnpm 12 guidance requires an independent `pnpm peers` audit after a
frozen install.

## Source identity and retained compiler evidence

The canonical comparison source-bundle hash was recomputed with
`docs/evidence/reproduce-typescript-7-comparison.sh --source-bundle-sha256` at the revision
in this report. Existing artifacts remain separate historical evidence:

| Artifact | SHA-256 | Recorded source identity | What it supports |
|---|---|---|---|
| `release-evidence/typescript-7-comparison.json` | `28da2c9be10f711d9eef805dafd698bc92a5a3c0bd3d0a57cd67853b2f80caeb` | `test-sha256:6c3f05086161635b2e9c417090a3c06291abb692760dd6c251c905b3d068ee43`; no capture timestamp | Advisory CLI run for TypeScript `6.0.3` versus `7.0.2`; status `ADVISORY_DRIFT`, not a current promotion pass |
| `docs/evidence/typescript-7-declaration-contracts-current.json` | `251574261e7752208d67a47b927c06156c8e3da2e4488ab7c4fddd3b379d3b48` | Captured `2026-10-15T11:26:57Z`; revision `858078ed44c8838cedfa80b40c4950ac42b668e2`; source bundle `3468d08570540775d10b5df16eb43ea0318545ded502e1ebfac822f47fb722a7` | That run's 983 declarations per compiler and classifications: 273 formatting-only, 9 approved semantic, 0 unexplained semantic |

These artifacts do not share the current revision or source-bundle identity. The old
declaration classification cannot be attached to the old compiler comparison, and neither
artifact is TypeScript 7.1 evidence. A fresh same-revision TypeScript 6/7.1 compiler result,
declaration manifest/classification, and output hashes are **MISSING** because the stable
candidate and compatible ecosystem are unavailable. No unexplained declaration drift is
claimed for the current revision.

## Gate results

| Gate | Result | Evidence / reason |
|---|---|---|
| Stable TypeScript 7.1 release and final docs/exports | **BLOCKED** | Official release list and npm tags show beta, not stable; final API guide is pending. |
| Fourteen source-module API map | **PASS for inventory; BLOCKED for stable replacements** | All fourteen modules are listed above and remain on TypeScript 6.0.3. No stable 7.1 API exists to test yet. |
| TypeDoc/plugin/Orval peer-clean candidate graph | **FAIL on published metadata** | Latest TypeDoc's TypeScript peer range ends at 6.0.x. |
| Disposable strict-peer install | **NOT REACHED** | No stable candidate; a beta install would not qualify migration readiness. |
| TypeDoc/plugin/Orval generation and runtime smokes | **NOT REACHED** | Blocked by stable-release and peer-compatibility prerequisites. |
| TypeScript 7.1 native runner smoke | **NOT REACHED** | No stable candidate package was installed. Historical Linux x64 evidence covers TypeScript 7.0.2 only. |
| Same-revision compiler/declaration comparison and hashes | **MISSING** | Retained comparison and classification artifacts have different source identities; no current 7.1 run exists. |
| Editor SDK candidate smoke | **NOT REACHED** | The editor remains configured for workspace TypeScript 6; no candidate promotion was attempted. |
| Promotion decision | **NO-GO; not attempted** | TypeScript 6 authority is unchanged. The September promotion checkpoint is historical and incomplete, not current evidence. |
| Existing TypeScript 6 API boundary | **PASS** | `pnpm run check:typescript-api-v6`: 12 tests passed; API reports version 6.0.3 and zero direct-import bypasses. |
| Comparison/declaration safeguard tests | **PASS** | `compare-typescript-7.test.mts` and `compare-declaration-contracts.test.mts`: 27 tests passed. |

The 2026-10-24 standard release-check state also predates this revision and records the
TypeScript 7 advisory comparison as blocked by a run-calculator typecheck. It is context
only, not a result for this reassessment.

## Unresolved findings and owners

| Finding | Status | Accountable owner | Next action |
|---|---|---|---|
| Stable 7.1 package and final API documentation are unavailable | **BLOCKED** | Microsoft TypeScript maintainers for publication; TypeScript toolchain maintainer for reassessment | Recheck the stable release list, npm `latest`, final docs, and exports after publication. |
| TypeDoc's declared TypeScript peer range excludes 7.x | **FAIL for the currently published graph** | TypeDoc maintainers for support metadata; TypeScript toolchain maintainer for validation | Wait for a TypeDoc release that declares candidate support, then run the disposable strict-peer install and independent peer audit. |
| Current compiler and declaration reports have different identities | **MISSING** | TypeScript toolchain maintainer | Once stable and peer prerequisites pass, generate both reports from one revision and source bundle and retain exact hashes. |
| Candidate runner/editor/promotion checks were not run | **NOT REACHED** | TypeScript toolchain maintainer; promotion requires separate approval | Run candidate checks only after stable API and ecosystem gates pass; keep TypeScript 6 authoritative until separately approved. |

## Next actions

After a stable TypeScript 7.1 package and final API documentation are actually published:

1. Re-read stable exports and documentation, then review each row above against stable APIs.
   Keep any unsupported consumers on the TypeScript 6 boundary.
2. Verify TypeDoc declares support for the candidate. In a disposable install, run a
   strict-peer install and an independent `pnpm peers` audit, then exercise TypeDoc,
   both plugins, Orval generation, and runtime imports.
3. Produce compiler and declaration evidence from the same Git revision and canonical
   source bundle. Retain exact compiler versions, output hashes, and per-file
   classifications; require zero unexplained semantic drift.
4. Only after those prerequisites pass, run candidate-native runner and editor SDK smokes.
   A compiler-authority promotion remains a separate approval and release-gate decision.

## Official sources

- [Microsoft TypeScript releases](https://github.com/microsoft/TypeScript/releases)
- [TypeScript npm dist-tags](https://registry.npmjs.org/-/package/typescript/dist-tags)
- [TypeScript 7.1 beta package metadata](https://registry.npmjs.org/typescript/7.1.0-beta)
- [TypeScript 7.1 beta announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/)
- [TypeScript 7.1 API status discussion](https://github.com/microsoft/TypeScript/issues/64709)
- [TypeScript 7.1 iteration plan](https://github.com/microsoft/TypeScript/issues/63703)
- [Using the Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)
- [TypeDoc latest registry metadata](https://registry.npmjs.org/typedoc/latest)
- [TypeDoc Markdown plugin latest metadata](https://registry.npmjs.org/typedoc-plugin-markdown/latest)
- [TypeDoc coverage plugin latest metadata](https://registry.npmjs.org/typedoc-plugin-coverage/latest)
- [Orval latest registry metadata](https://registry.npmjs.org/orval/latest)

