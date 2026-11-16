# Workspace dependency upgrade report — 2026-11-16

## Outcome

Updated eligible workspace dependencies and aligned the pinned runtime,
lockfile, GitHub Actions, and container builder. No new package was added.
The generated inventory is in
[`dependency-workspace-inventory-2026-11-16.json`](./dependency-workspace-inventory-2026-11-16.json).

## Direct package updates

| Package | Previous | Updated |
| --- | --- | --- |
| `@google/genai` | `2.30.0` | `3.3.0` |
| `@hookform/resolvers` | `5.9.2` | `7.0.6` |
| `@playwright/test` | `1.64.1` | `1.65.1` |
| `@tailwindcss/vite` | `4.3.3` | `4.3.5` |
| `@tanstack/react-query` | `5.104.4` | `5.107.1` |
| `@testing-library/user-event` | `14.6.8` | `14.6.10` |
| `@types/node` | `26.6.5` | `26.6.6` |
| `@vitejs/plugin-react` | `6.1.2` | `6.3.0` |
| `jsdom` | `30.1.3` | `31.0.1` |
| `lucide-react` | `1.59.0` | `1.73.0` |
| `openai` | `7.38.0` | `7.57.0` |
| `orval` | `8.46.0` | `8.48.0` |
| `p-retry` | `8.0.1` | `9.0.0` |
| `prettier` | `3.9.10` | `3.10.1` |
| `react-hook-form` | `7.90.0` | `7.92.0` |
| `react-resizable-panels` | `4.14.5` | `4.23.0` |
| `tailwindcss` | `4.3.3` | `4.3.5` |
| `thread-stream` | `4.2.0` | `4.2.1` |
| `typedoc-plugin-markdown` | `4.14.0` | `4.14.1` |
| `vite` | `8.3.4` | `8.3.8` |
| `vitest` | `5.0.5` | `5.1.0` |
| `web-push` | `3.6.7` | `4.0.0` |

The `web-push` v4 migration now uses its ESM exports and bundled types; the
separate `@types/web-push` package was removed. `@google/genai` v3 explicitly
requests `v1beta` to preserve the prior API behavior. Generated Orval clients
and schemas were regenerated. The `wouter` declaration now uses the existing
workspace catalog entry; its resolved version did not change. Vitest and
`@vitest/mocker` overrides now match Vitest `5.1.0`, and the esbuild override
range is `^0.28.2`.

`@types/node` is type-only and does not select the Node runtime. It was initially
updated to `26.6.6`, then aligned with the Node 24 type surface during the
follow-up below (resolved `24.19.2`). All runtime and build execution was
verified on Node `24.22.2`.

## Runtime, workflows, and containers

- Node is pinned to `24.22.2`; pnpm is pinned to `12.21.0`. The `.replit`
  Project workflow, Node runner, CI, Docker builder, tests, and README use the
  agreed runtime/toolchain contract.
- GitHub Actions remain SHA-pinned. All current action releases and immutable
  SHAs were checked against upstream release/tag information; workflow diffs
  only update the `pnpm/action-setup` pin to v6.1.1. No triggers, permissions,
  secrets, caches, artifact boundaries, or deployment authority changed.
- The Caddy image now names `2.11.9-alpine` while retaining its verified digest.
- The Docker builder snapshot moved to `20261015T000000Z` after the pinned Node
  image's installed `perl-base` `5.36.0-7+deb12u4` conflicted with the August
  snapshot's `5.36.0-7+deb12u3`. The October snapshot supplies matching
  `perl`/`perl-base` packages. The reviewed package record is in
  [`container-builder-security-refresh.md`](./container-builder-security-refresh.md).
- API, web, and migration-smoke container targets passed. The no-cache API
  image build also passed.

## Verification

| Check | Result |
| --- | --- |
| Frozen workspace install | Passed |
| Calculator client tests | 398 files passed, 1 skipped; 3,932 tests passed, 1 skipped |
| API isolated unit tests | 137 files; 1,371/1,371 passed |
| OpenAI integration tests | 30/30 passed |
| Full workspace typecheck | Passed on Node `24.22.2` |
| Workflow syntax/action check | Passed for 15 workflow files |
| Strict dependency-use check | Passed |
| Clean-start check | Passed: API readiness, web, sign-in fallback, proxy, and Vite reconnect checks |
| Production dependency audit | Passed; no known production vulnerabilities |
| Peer dependency check | Passed; peer requirements satisfied |
| Docker API, web, and migration-smoke targets | Passed |
| No-cache Docker API build | Passed |
| `git diff --check` | Passed after the final documentation edits |

The full isolated browser suite initially ran 241 cases: 236 passed and 5
failed. Focused reruns clarified the failures:

- The field-check export test had stale v1 expectations. Its expectation was
  updated to schema v2 and server-reported development provenance; the focused
  rerun passed.
- The visual saved-state test passed after its settling timeout was raised to
  15 seconds.
- The sync-convergence test passed in its focused rerun after failing once in
  the full run.
- The accessibility smoke test still fails honestly: six requests
  (`/api/me`, `/api/sync/today`, `/api/field-checks/observations`, and
  `/api/incidents`) remained in flight after the test's 15-second wait before
  an intentional reload. This is browser wait evidence; it does not establish
  server processing time, and the requests were not whitelisted as harmless.
- The Packaging wake/reload test still disagrees with its expected case count:
  it observed 46 to 49 cases where the test expected 47, with server and client
  claims overlapping. The timing evidence may reflect multiple elapsed
  six-second intervals; whether this is a product defect or a test expectation
  issue remains unresolved. No production auto-tracking behavior was changed.

The whole browser suite was not rerun after those test-only corrections. The
two remaining focused findings are separate from the package changes and need
follow-up investigation.

The local `run-release-node.test.sh` suite passed its first 13 checks, then
could not bind IPv6 loopback (`EAFNOSUPPORT` for `::1`). The TLS behavior was not
weakened or skipped; this local environment cannot verify that case.

## Deferred dependency and release items

- `@testing-library/user-event` `14.6.11` and `14.6.12` were published within
  the 24-hour minimum-age window; the workspace remains at `14.6.10`. The
  newest version becomes eligible at `2026-11-17 02:31Z`.
- TypeScript `7.0.2` remains held because of documented workspace compatibility
  blockers; TypeScript `6.0.3` passes the full typecheck.
- Full audit reports one low-severity, unpatched `deepmerge` advisory through
  `vite-plugin-pwa` / Workbox. The production audit is clean.
- `node-domexception@1.0.0` remains deprecated transitively through the
  Google-auth/fetch dependency chain; no upstream fix was available.
- Existing `web-push` is MPL-2.0. Its initial version review was pending; the
  policy owner's approval of `web-push@4.0.0` is recorded in the follow-up below.
- `npm` prints informational warnings for the existing pnpm-only
  `auto-install-peers` and `strict-peer-dependencies` configuration keys.

## Follow-up reassessment — 2026-11-16

The registry was rechecked at `2026-11-16 18:14Z` with the pinned Node
`24.22.2` / pnpm `12.21.0` toolchain:

- `@testing-library/user-event` `14.6.11` was published at `2026-11-16
  00:48:29Z`, and `14.6.12` at `2026-11-16 02:31:48Z`. Both are still inside
  the workspace's 24-hour minimum-age window. Keep `14.6.10`; do not bypass the
  policy. Recheck after `2026-11-17 02:31:48Z`; update to `14.6.12` only if the
  calculator tests pass.
- TypeScript's `latest` tag remains `7.0.2`; `7.1` is still beta and the `next`
  tag is a development build. TypeDoc `0.28.20` still declares TypeScript peers
  only through `6.0.x`. Keep TypeScript 6.0.3 authoritative and TypeScript 7
  advisory-only; the compatibility blockers remain.
- Align the type-only `@types/node` catalog with the Node 24 runtime at
  `^24.19.2` (resolved `24.19.2`). The full workspace typecheck passed on Node
  `24.22.2` after making the API test's Node `TextDecoder` import explicit.
- The full audit still reports one low-severity, development-only
  `deepmerge@4.3.1` finding (`GHSA-gcqx-w48m-w2h4`) through
  `vite-plugin-pwa@2.0.0` → `workbox-build@7.4.1` →
  `@rollup/plugin-node-resolve@16.0.3`. The advisory lists no patched version;
  those parent versions are current, and no safe override can select a fix.
  The production audit reports no known vulnerabilities.
- The deprecated `node-domexception@1.0.0` path remains through
  `node-fetch@3.3.2` → `fetch-blob@3.2.0`. Current `node-fetch@3.3.2` still
  requires `fetch-blob` 3.x, while `fetch-blob@4.0.0` is outside that range.
  The latest `@google/genai@3.3.0` still requires
  `google-auth-library@^10.3.0`; the newer Google Auth 11.x line is not a
  compatible parent update. No supported upstream update removes the path.
- Frozen install passed, full workspace typecheck passed, and `pnpm peers`
  found peer requirements satisfied (with existing undeclared-peer warnings).
  Full audit remains nonzero only for the single low deepmerge advisory;
  production audit passed. On `2026-11-16`, the owner accepted the residual
  build-time finding temporarily until upstream publishes a fix. This is risk
  acceptance, not a clean full-audit result.
- The existing license approval is version-specific to `web-push@3.6.7`.
  On `2026-11-16`, the authorized policy owner approved `web-push@4.0.0` under
  MPL-2.0. This approval applies only to version `4.0.0`; no broader MPL
  approval is inferred. See
  [`web-push-license-approval-2026-11-16.md`](evidence/web-push-license-approval-2026-11-16.md).

The standard release check did not run release gates because published release
evidence is missing. Production readiness is **NO-GO**. No production database
was read or changed, and nothing was published.
