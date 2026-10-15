# vite-plugin-pwa 2.0.0 isolated evaluation

## Decision

**GO for a plugin-only upgrade to `vite-plugin-pwa` 2.0.0.** The isolated candidate built successfully, generated the same manifest and Workbox implementation, and passed the focused PWA suite in Chromium and WebKit. This task did not change the supported dependency; `artifacts/run-calculator/package.json` remains on `^1.3.0`, with 1.3.0 in the supported lockfile.

This is not a GO for claiming that authenticated production screens cold-start offline. That behavior is unavailable with either plugin version: the app shell loads from cache, but the session check cannot reach `/api/me` and the app shows “Unable to open Run Calculator.”

**Cold offline session recovery is not approved at this time.** Keep the current behavior: a cold offline launch may load the cached app shell, but it must not restore the authenticated production screen. An already-open run remains visible and usable when its connection drops; that existing in-memory continuity does not establish an authenticated session for a later cold start.

The startup identity check in `artifacts/run-calculator/src/AuthContext.tsx` calls `/api/me` and uses the server-set HttpOnly `rc_auth` cookie; it does not restore an identity from persistent client storage. The API checks the token against current server-side session and account state, including reset, account-disable, password-change, and revocation fences. Offline, the client cannot determine whether any of those checks would now reject the session. Do not persist or trust a cached identity, cookie/token, or operational data as proof of current authorization. If this decision is revisited, first define the exact cached data allowed, its freshness and shared-device clearing rules, whether it is read-only, and the required online re-authentication before enabling server operations. No such offline restoration or cached operational view is authorized by this decision.

When implementing the plugin upgrade, keep it isolated from unrelated lockfile updates. The temporary 2.0.0 evaluation branch also resolved `lru-cache` from 11.5.2 to 11.5.3; that was not part of the PWA plugin release and must not be carried into an upgrade without its own review.

## Scope and method

- Supported source revision: `f8f17a89` (`Replit` branch).
- Candidate: temporary worktree branch `eval/pwa-plugin-2.0.0`, with the run-calculator package set to `vite-plugin-pwa` 2.0.0. The worktree was separate from the supported checkout.
- Both builds used Vite 8.3.4, Workbox 7.4.1, and the same application source. The supported checkout stayed on 1.3.0.
- Release notes: [vite-plugin-pwa v2.0.0](https://github.com/vite-pwa/vite-plugin-pwa/releases/tag/v2.0.0). Its only listed enhancement is widening the optional `@vite-pwa/assets-generator` peer range to include 2.x. The package metadata keeps the same Vite 3–8 and Workbox 7.4 peer ranges; 2.0.0 raises the Node minimum to 20.19.0. The workspace's Node 24 runtime satisfies it. This app does not directly depend on `@vite-pwa/assets-generator`.

## Generated output comparison

| Output | 1.3.0 | 2.0.0 candidate | Result |
| --- | ---: | ---: | --- |
| `manifest.webmanifest` | 563 bytes | 563 bytes | Byte-identical, SHA-256 `7a337294c17872facfe732d61aec4112d9b90064f8dafe6e91146a2bd68b50e1` |
| `service-worker.js` | 30,309 bytes | 30,309 bytes | Same Workbox code outside the injected precache list |
| Precache entries | 85 | 85 | Same count |
| Hashed JS/CSS asset URLs | 68 | 68 | URLs differ because the temporary candidate lock also updated `lru-cache`; do not attribute those bundle hash changes to the PWA plugin |
| Manifest-referenced icons | 4 | 4 | All exist in the build and return HTTP 200 in browser checks |

Both manifests contain the same app name, short name, start URL `/`, scope `/`, `display: "standalone"`, theme color, portrait orientation, three PNG sizes, and one maskable icon. Both generated HTML files are 3,176 bytes and link to `/manifest.webmanifest`. The page entry bundle hashes differ, so the `index.html` precache revision and injected asset list differ; all other stable public-file revisions match. The service-worker logic surrounding the injected precache list is byte-identical.

## Browser results

Each version passed the same 14 focused checks:

- Desktop Chromium: all 4 PWA handoff tests passed — active-run update prompt, safe update reload, already-safe update, and stale-chunk fallback.
- Desktop WebKit: the same 4 tests passed.
- Phone emulation in Chromium and WebKit: offline/install-contract smoke passed.
- Tablet portrait emulation in Chromium and WebKit: offline/install-contract smoke passed.
- Tablet landscape emulation in Chromium and WebKit: offline/install-contract smoke passed.

The offline/install-contract smoke checks the generated app shell, manifest link and fields, all declared icon URLs, service-worker activation, and a network drop during an active run. That active run remains visible while the page stays open. A cold offline reload uses the cached app shell but displays the session-verification fallback; the authenticated run screen is not restored. This matched in 1.3.0 and 2.0.0.

The browser tests verify installation metadata and icon delivery, not the browser/OS installation dialog. Physical Android Chrome and physical iOS Safari/Add to Home Screen were **not run**; emulation and desktop WebKit are not physical-device evidence.

## Risks and failure ledger

| Finding | Status | Evidence / disposition |
| --- | --- | --- |
| Cold offline reload cannot confirm the staff session, so it does not reopen the production screen | Resolved by policy decision; behavior unchanged | Browser smoke sees the service-worker-cached document, then “Unable to open Run Calculator.” `AuthContext.tsx` requires `/api/me`; the server applies current session/account/reset checks that cannot be verified offline. Cold offline restoration is not approved. |
| Candidate dependency install initially omitted a workspace-package link | Resolved | The first candidate build failed resolving `@workspace/name-match`; a full workspace install in the temporary worktree restored links. The subsequent candidate build and browser runs passed. |
| WebKit reported unavailable external Google Fonts in the network-isolated fixture | Resolved in test harness | The stale-chunk test ignores only errors naming the external `fonts.googleapis.com/css2` stylesheet; all other page errors remain failures. |
| Candidate lock resolution updated unrelated `lru-cache` 11.5.2 → 11.5.3 | Evaluation-only caveat | The supported package manifest and lockfile are unchanged. Keep unrelated resolution drift out of the eventual upgrade. |

## Compatibility applicability

| Surface | Result |
| --- | --- |
| Desktop Chromium / Chrome | PASS for both plugin versions |
| Phone Chromium emulation | PASS for both plugin versions |
| Tablet portrait Chromium emulation | PASS for both plugin versions |
| Tablet landscape Chromium emulation | PASS for both plugin versions |
| Desktop WebKit / Safari engine emulation | PASS for both plugin versions |
| Phone WebKit emulation | PASS for both plugin versions |
| Tablet portrait WebKit emulation | PASS for both plugin versions |
| Tablet landscape WebKit emulation | PASS for both plugin versions |
| Physical Android Chrome | NOT RUN — no physical-device browser session was configured; emulation is not a substitute |
| Physical iOS Safari/PWA | NOT RUN — no physical-device browser session was configured; desktop WebKit is not a substitute |

Focused verification also passed `pnpm --filter @workspace/run-calculator run check:e2e:syntax` and `git diff --check`. The app build emits the same existing large-chunk and ineffective-dynamic-import warnings for both plugin versions.
