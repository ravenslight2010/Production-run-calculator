# Build and test dependency remediation — 2026-11-05

## Result

The live workspace audit fell from 16 advisories (4 high, 8 moderate, 4 low) to 3 (0 high, 2 moderate, 1 low). The production-only audit remains clear. No audit threshold, pnpm pin, release-age policy, Node/TypeScript toolchain, or optional-package protection was changed.

## Changes and dependency review

- Updated `lib/api-spec`'s exact-pinned Orval from 8.43.0 to 8.46.0. The release is older than the 1,440-minute release-age policy, supports Node `>=22.18.0`, and retains compatibility with the installed TypeDoc `^0.28.19` and typedoc-plugin-markdown `^4.10.0` peer ranges. Its dependency update replaces Scalar's older `@scalar/json-magic@0.15.7` exact Undici 7.29.1 pin with 0.16.1 / Undici 7.30.1. The subsequent generated API output was regenerated and inspected; generator output changed formatting across generated types, and the repository's generated-output check passes.
- Removed the workspace-wide `undici: 7.29.1` override. That override forced `jsdom@30.1.3`, which declares `undici: ^8.12.1`, down to major 7. The lockfile now resolves Undici 8.12.3 for jsdom and the newer Scalar parser chain, while Scalar's 0.16.1 package uses fixed Undici 7.30.1. The updated Orval parent releases the Scalar dependency's exact vulnerable pin, so no Undici override is needed.
- Updated the existing global `fast-uri` override from 3.1.8 to fixed 3.1.9. All current Ajv consumers declare a compatible `^3.0.1` range.
- Updated the existing narrowly scoped `@rollup/plugin-terser>serialize-javascript` override from 7.1.2 to fixed 7.1.3. The parent declares `serialize-javascript: ^7.0.3`.
- Did not update Vitest: 5.1.0 is compatible with the current Vite/Node versions, but it does not remove jsdom's Undici path, and its release requires coordinated exact pins for Vitest and `@vitest/mocker`. It would not remediate the remaining advisories.

Registry metadata checked on 2026-11-05:

- Orval 8.46.0 release notes and npm metadata: https://github.com/orval-labs/orval/releases/tag/v8.46.0 and https://registry.npmjs.org/orval/8.46.0.
- Fixed package metadata: `undici@7.30.1`, `fast-uri@3.1.9`, and `serialize-javascript@7.1.3`.
- Current parent releases: `vite-plugin-pwa@2.0.0`, `workbox-build@7.4.1`, `@rollup/plugin-node-resolve@16.0.3`, and `typedoc@0.28.20`.

## Remaining audit findings and safe next action

`pnpm audit --json` still exits 1 because the following findings have no available compatible parent fix in the current registry snapshot. The audit record reports no `fixAvailable` entry for these advisories:

| Package | Locked version and path | Advisory / compatibility | Next safe action |
|---|---|---|---|
| `glob` | 11.1.0 through `vite-plugin-pwa@2.0.0 → workbox-build@7.4.1` | Moderate; advisory range is `>=9.0.0 <=14.0.1`, and registry's latest glob is 14.0.3. Workbox declares `glob: ^11.0.1`, so forcing glob 14 would cross a major range. | Reassess after Workbox/PWA publishes a compatible parent release; test PWA/service-worker output before adopting it. |
| `minimatch` | 10.2.6 through both Workbox's glob 11 path and TypeDoc 0.28.20 paths | Moderate; fixed range starts at 11.0.1. Workbox/glob and TypeDoc currently depend on minimatch 10.x. Latest TypeDoc is 0.28.20 and latest glob is 14.0.3; do not force minimatch 11 into the current parent ranges. | Reassess the TypeDoc and Workbox parent chains when they publish compatible ranges; run docs/codegen and PWA checks. |
| `deepmerge` | 4.3.1 through `workbox-build@7.4.1 → @rollup/plugin-node-resolve@16.0.3` | Low; audit metadata contains no fix version. `@rollup/plugin-node-resolve` currently declares `deepmerge: ^4.2.2`, but the current registry release is still 16.0.3 and no patched deepmerge release is identified. | Wait for an upstream deepmerge fix or parent release that removes/replaces it; verify its advisory and compatibility metadata before changing the graph. |

No global override was added for glob, minimatch, or deepmerge. In particular, glob 14 and minimatch 11 are major upgrades outside current parent ranges, and an audit result without a fixed deepmerge version is not evidence for an invented override.

## Verification

- `pnpm install --lockfile-only` — PASS; supply-chain policy accepted the lockfile.
- `pnpm install --frozen-lockfile` — PASS.
- `pnpm audit --json` — 3 advisories remain (0 high, 2 moderate, 1 low); exit 1 as expected for unresolved findings.
- `pnpm run audit:prod:release` — PASS; no known production vulnerabilities at the configured high threshold.
- `pnpm run check:api-generated` — PASS after regenerating the Orval output; generated Zod checks passed.
- `pnpm run typecheck` — PASS.
- `PORT=5000 BASE_PATH=/ pnpm --filter @workspace/run-calculator exec vite build --config vite.config.ts` — PASS; emitted the production service worker and Workbox precache.
- `pnpm --filter @workspace/run-calculator run build` — BLOCKED before Vite by the repository's stale/incomplete web build-identity guard. The focused Vite build above exercised the updated PWA/Workbox path without changing release identity.
- `pnpm --filter @workspace/run-calculator run test` — FAIL: 3,912 passed, 1 failed, 1 skipped across 3,914 tests. The failure reproduces in isolation in `src/autoTrackFreezerDrain.test.tsx`: the paused Stage 3 drain assertion expected 64 cases and received 63. Neither that test nor application behavior was changed in this dependency task; the failure is recorded rather than repaired outside scope.

The complete client test failure is a separate live-counter correctness issue. It should be triaged by its owning operational/state-accuracy work before changing `useAutoTrack`; no claim is made here that it predates this dependency update.
