# Workspace dependency inventory and refresh — 2026-10-14

## Summary

Refreshed compatible patch/minor dependencies across the pnpm workspace without promoting Node, TypeScript, or pnpm and without installing major upgrades. The complete direct registry dependency inventory below reconciles every manifest declaration with its lockfile importer resolution, including expanded workspace-catalog ranges, aliases, shared packages, and peer constraints.

At the end of the review, the only remaining direct update candidates reported by `pnpm outdated -r --format json` were two major upgrades, the exact-pinned Orval release, and the separate TypeScript 7 investigation. No mature, eligible in-range patch/minor update remained. The outdated command's exit code 1 indicates that it found candidates; it is not a dependency-resolution failure.

## Scope and method

- Reviewed all 51 workspace manifests and all 51 lockfile importers. There are 47 importers with external direct declarations and four with none: `lib/ai-memory`, `lib/allergen`, `lib/recipe-apply`, and `lib/factory-constants`.
- Reconciled 235 external declarations: 233 installable dependency declarations and two peer constraints. They resolve to 112 unique registry package keys. Every installable importer declaration has a corresponding lockfile resolution.
- The inventory table records each package's declaration and importer, then its resolved version. `catalog` marks a range expanded from `pnpm-workspace.yaml`; `dep`, `dev`, `opt`, and `peer` mean production, development, optional, and peer dependency. React peer constraints resolve against workspace React 19.3.0. For readability, peer-qualified suffixes are omitted from displayed lockfile versions; the lockfile retains them.
- `pnpm-lock.yaml` is a two-document YAML stream with pnpm bootstrap/platform metadata in the first document and workspace catalogs, importers, packages, and snapshots in the last. Resolution comparison used the latter.
- Queried registry publication, engine, and peer metadata at **2026-10-14 16:46 UTC**; checked package release notes and affected importer usage for compatibility-sensitive updates. The configured `minimumReleaseAge: 1440` (24 hours) in `pnpm-workspace.yaml` was left intact and enforced during install. Every selected version met that age floor and had compatible engines/peers for its actual consumers; no policy exclusions were added.
- Cross-checked recursive outdated output against all manifests, catalog entries, and lockfile importers rather than relying on its `wanted` values or importer enumeration.
- Primary release references: [Vite 8.3.4](https://github.com/vitejs/vite/releases/tag/v8.3.4), [Vitest 5.0.4](https://github.com/vitest-dev/vitest/releases/tag/v5.0.4), [Radix releases](https://www.radix-ui.com/primitives/docs/overview/releases), [Google GenAI 2.29.1](https://github.com/googleapis/js-genai/releases/tag/v2.29.1), [OpenAI 7.32.0](https://github.com/openai/openai-node/releases/tag/v7.32.0), [Playwright 1.64.0](https://github.com/microsoft/playwright/releases/tag/v1.64.0), and [React Motion upgrade guide](https://motion.dev/docs/react-upgrade-guide).

## Installed compatible updates

| Package or group | Previous → installed | Scope and decision |
|---|---|---|
| `prettier` | 3.9.9 → 3.9.10 | Root development tooling; in-range patch. |
| `@google/genai` | 2.27.0 → 2.29.1 | API server and shared provider integration; compatible 2.x release. |
| `drizzle-orm` | 0.45.3 → 0.45.4 | API server and DB library; patch only, no schema change. |
| `express` | 5.2.1 → 5.3.0 | API server; compatible 5.x update. |
| `pino`, `pino-pretty` | 10.3.1 → 10.4.0; 13.1.3 → 13.2.0 | API logging runtime and development formatter. |
| Catalog: `zod`, `@types/node`, `@tanstack/react-query` | 4.6.5 → 4.6.7; 26.6.4 → 26.6.5; 5.104.1 → 5.104.2 | Updated the shared catalog ranges and corresponding lock resolutions. `@types/node` is declarations only; Node runtime remains 24. |
| Web tooling and UI: `@vitejs/plugin-react`, `framer-motion`, `lucide-react`, `react-hook-form`, `react-resizable-panels`, `vite` | 6.1.1 → 6.1.2; 13.2.0 → 13.5.1; 1.52.0 → 1.56.0; 7.89.0 → 7.90.0; 4.14.2 → 4.14.5; 8.3.2 → 8.3.4 | Compatible in-range updates across the applicable web artifacts. |
| Radix UI primitives | 27 coordinated package updates in both web artifacts | `accordion` 1.2.20→1.3.1; `alert-dialog` 1.1.23→1.2.1; `aspect-ratio` 1.1.15→1.2.0; `avatar` 1.2.6→1.3.1; `checkbox` 1.3.11→1.4.1; `collapsible` 1.1.20→1.2.1; `context-menu` 2.3.7→2.4.1; `dialog` 1.1.23→1.3.1; `dropdown-menu` 2.1.24→2.2.1; `hover-card` 1.1.23→1.2.1; `label` 2.1.15→2.1.17; `menubar` 1.1.24→1.2.1; `navigation-menu` 1.2.22→1.4.1; `popover` 1.1.23→1.3.1; `progress` 1.1.16→1.2.1; `radio-group` 1.4.7→1.5.1; `scroll-area` 1.2.18→1.4.0; `select` 2.3.7→2.4.1; `separator` 1.1.15→1.2.0; `slider` 1.4.7→1.6.1; `slot` 1.3.3→1.5.0; `switch` 1.3.7→1.4.1; `tabs` 1.1.21→1.2.1; `toast` 1.2.23→1.3.1; `toggle` 1.1.18→1.2.1; `toggle-group` 1.1.19→1.2.1; `tooltip` 1.2.16→1.4.1. |
| Browser and test tooling: `@playwright/test`, `@testing-library/user-event`, `axe-core` | 1.63.0 → 1.64.0; 14.6.7 → 14.6.8; 4.13.0 → 4.14.0 | Playwright, `playwright`, and `playwright-core` remain aligned at 1.64.0. |
| `openai` | 7.28.0 → 7.32.0 | Shared provider integration; compatible in-range update. |
| Vitest family | 5.0.3 → 5.0.4 | Updated 36 workspace Vitest resolutions and the paired `vitest` / `@vitest/mocker` overrides together. Two existing manifests retain `^4.1.9` declarations (`lib/ai-evaluation` and `scripts`); the established workspace override intentionally resolves them to Vitest 5.0.4. Those declarations were not widened as part of a patch refresh. |

The registry query also found newer releases that were less than 24 hours old and therefore deferred by policy: `lucide-react` 1.57.0, `@playwright/test` 1.64.1, and `openai` 7.33.0. No release-age setting or exclusion was changed to install them.

## Major and exact-pin candidates deferred

No major version was installed.

| Candidate | Current → candidate | Importers | Risk and bounded evaluation recommendation |
|---|---|---|---|
| `vite-plugin-pwa` | 1.3.0 → 2.0.0 | `artifacts/run-calculator` | **High**: service-worker registration, offline caching, update/install behavior, and fallbacks are sensitive to plugin changes. The [2.0.0 release](https://github.com/vite-pwa/vite-plugin-pwa/releases/tag/v2.0.0) warrants an isolated branch evaluation: compare generated worker/config output, then test offline startup, cache refresh, update prompts, install flow, and fallback behavior before a separate approval. |
| `framer-motion` | 13.5.1 → 14.2.0 | `artifacts/run-calculator`, `artifacts/mockup-sandbox` | **Medium**: the [upgrade guide](https://motion.dev/docs/react-upgrade-guide) describes a migration path without broad breaking changes, but API deprecations and stricter package alignment can affect animations. Evaluate both artifact builds, existing animation call sites, reduced-motion handling, and responsive Chromium/WebKit flows in isolation. |

Other deferred candidates:

- `orval` is exact-pinned at 8.40.0; registry/outdated metadata reports 8.42.0. Keep the pin for now because code generation can change checked-in API output. Evaluate separately with `pnpm run check:api-generated` and a reviewed generated diff; see the [8.42.0 release](https://github.com/orval-labs/orval/releases/tag/v8.42.0).
- TypeScript 6.0.3 → 7.0.2 appeared in outdated output, but compiler qualification belongs to the existing TypeScript investigation. The root compiler remains `~6.0.3`; `typescript-native` remains the existing 7.0.2 comparison alias.
- Node runtime qualification remains in its separate task. `.nvmrc` remains 24.21.0.
- The pnpm pin remains `pnpm@12.8.1`. No runtime, compiler, package-manager, security-policy, or release-age baseline was promoted.

## Lockfile, overrides, and advisory review

- A frozen install passed after all manifest/catalog edits. The generated lockfile has 863 package keys before and after; 78 old keys were replaced by 78 new keys, with two peer-metadata-only Vite changes. The diff is consistent with the selected direct updates and resolver changes; no indiscriminate transitive rewrite was performed.
- Existing security overrides and platform-specific optional-package protections were preserved. Only the paired Vitest and `@vitest/mocker` patch override moved to 5.0.4. No security override was broadened or removed.
- Production audit (`pnpm run audit:prod:release`) passed with no high/critical findings; full-workspace `pnpm audit --json` reported zero advisories.
- `pnpm why -r glob node-domexception` found two deprecated transitive packages, not security advisories: `glob@11.1.0` through `workbox-build@7.4.1` / `vite-plugin-pwa@1.3.0` in the run calculator, and `node-domexception@1.0.0` through the Google auth/Fetch chain from `@google/genai@2.29.1` in the API/provider workspaces. Both audits are clean. Keep overrides unchanged; revisit with the corresponding upstream parent update rather than forcing an unrelated transitive replacement.

## Verification and unresolved-results ledger

| Check | Result | Evidence / next action |
|---|---|---|
| `pnpm install --frozen-lockfile` | **PASS** | Completed after all dependency and catalog changes. |
| Production audit | **PASS** | `pnpm run audit:prod:release`; no high/critical findings. |
| Full-workspace audit | **PASS** | `pnpm audit --json`; zero advisories. |
| API generated output | **PASS** | `pnpm run check:api-generated`; no unreviewed regeneration. Orval remained at 8.40.0. |
| Workspace typecheck | **PASS** | `CI=true pnpm run typecheck`; libraries, artifacts, and scripts completed. |
| Provider-focused tests | **PASS** | Five Gemini / AI batch, retry, and parse test files; 43 tests passed. |
| API isolated unit suite | **PASS** | 101 files, 1,011 tests passed against the approved disposable test database; database setup and cleanup completed. |
| API development build | **PASS** | Development-identity build completed. No schema push or production-mode build preparation was run. |
| Shared-library suites | **PASS** | All shared-library test suites passed. Corpus snapshot was regenerated using its authoritative command; only its evaluation manifest changed (lock hash and Vitest version; data hashes unchanged), and its focused suite passed 12/12. |
| Scripts privacy test | **PASS** | Focused privacy test passed. |
| Run-calculator tests and build | **PASS** | Budget suite: 106 files, 2,099 passed, one skipped. Development build passed. |
| Mockup-sandbox tests and build | **PASS** | 71 tests passed. Development build passed with its configured `PORT=8081` and `BASE_PATH=/__mockup`. |
| Frontend workflow startup and visual preview | **PASS** | Both workflows restarted cleanly on Vite 8.3.4. The run-calculator preview shows its expected sign-in gate; the mockup server shows its component-preview landing page. Signed-in UI was not verified. |
| `git diff --check` and report whitespace | **PASS** | Checked after the report was added; no whitespace errors. |
| `pnpm outdated -r --format json` | **PASS (informational candidates)** | Exit 1 is the command's expected “updates available” status. Reconciled candidates are the two majors, exact-pinned Orval, and separately tracked TypeScript; no eligible in-range patch/minor candidates remain. |
| Browser compatibility matrix | **FAIL** | Eight tests: four passed, four failed. Desktop and phone Chromium passed; tablet portrait and landscape Chromium failed during onboarding/navigation with a destroyed execution context. Phone and tablet WebKit cases timed out waiting for `POST /api/me/onboarding-seen`. Owner: run-calculator browser-test and API onboarding maintainers. Next: reproduce against a clean isolated test database and investigate onboarding navigation/request timing. No causal link to a dependency update is established. |
| WebKit smoke, external-host mode | **BLOCKED** | Three tests could not use external HTTPS because this host reports “TLS support is not available”; Playwright also reported missing WebKit host libraries. No external URL is included here. |
| WebKit smoke, isolated local-server retry | **FAIL** | One of three passed (sync-recovery); current-run start/pause/resume and authoritative-report cases each timed out waiting for the onboarding-seen POST. The summary was captured; the runner then hung during teardown and was stopped to release its isolated servers. Owner/next action are the same as the browser compatibility failures above. |
| Physical Android Chrome and iOS Safari/PWA | **BLOCKED** | Both readiness checks ran without masking environment settings and reported no configured device-service endpoint; neither physical test was started. Owner: workspace operator. Next: configure the injected device connection and rerun. Emulation is not physical-device proof. |
| `release:standard` | **BLOCKED (stopped with user approval)** | User approved stopping the stalled check. It had reached API integration shard 3/7 after about 161 seconds without completing. No release result was produced. Owner: release-check maintainers. Next: rerun the focused stalled shard when its test/database lane is available; do not infer a pass from the stop. |
| API publish-mode build | **NOT REACHED** | The prepared-source fingerprint was stale (“Build source changed. Run prepare:publish again before publishing.”). The development build passed. Refreshing publish identity is release preparation and was not performed in this dependency task; owner: release maintainers, next action: refresh it only in an approved release-preparation run. |

The browser failures are retained as evidence, not converted into a recursive validation task. No publish or release decision was made. The prior unrelated working-tree edits in the cheese integration test, TypeScript comparison evidence, and release-check/stress-test files were preserved.

## Complete direct registry dependency inventory

Each declaration below is reconciled to the version selected by its lockfile importer. The table includes all workspace catalog consumers and packages shared across importers.

| Package | Manifest declaration → importer lockfile version |
|---|---|
| `@axe-core/playwright` | artifacts/run-calculator dev ^4.13.0 → 4.13.0 |
| `@google/genai` | artifacts/api-server dep ^2.29.1 → 2.29.1; lib/integrations-openai-ai-server dep ^2.29.1 → 2.29.1 |
| `@hookform/resolvers` | artifacts/mockup-sandbox dev ^5.9.1 → 5.9.1; artifacts/run-calculator dev ^5.9.1 → 5.9.1 |
| `@playwright/test` | artifacts/run-calculator dev ^1.64.0 → 1.64.0 |
| `@radix-ui/react-accordion` | artifacts/mockup-sandbox dev ^1.3.1 → 1.3.1; artifacts/run-calculator dev ^1.3.1 → 1.3.1 |
| `@radix-ui/react-alert-dialog` | artifacts/mockup-sandbox dev ^1.2.1 → 1.2.1; artifacts/run-calculator dev ^1.2.1 → 1.2.1 |
| `@radix-ui/react-aspect-ratio` | artifacts/mockup-sandbox dev ^1.2.0 → 1.2.0; artifacts/run-calculator dev ^1.2.0 → 1.2.0 |
| `@radix-ui/react-avatar` | artifacts/mockup-sandbox dev ^1.3.1 → 1.3.1; artifacts/run-calculator dev ^1.3.1 → 1.3.1 |
| `@radix-ui/react-checkbox` | artifacts/mockup-sandbox dev ^1.4.1 → 1.4.1; artifacts/run-calculator dev ^1.4.1 → 1.4.1 |
| `@radix-ui/react-collapsible` | artifacts/mockup-sandbox dev ^1.2.1 → 1.2.1; artifacts/run-calculator dev ^1.2.1 → 1.2.1 |
| `@radix-ui/react-context-menu` | artifacts/mockup-sandbox dev ^2.4.1 → 2.4.1; artifacts/run-calculator dev ^2.4.1 → 2.4.1 |
| `@radix-ui/react-dialog` | artifacts/mockup-sandbox dev ^1.3.1 → 1.3.1; artifacts/run-calculator dev ^1.3.1 → 1.3.1 |
| `@radix-ui/react-dropdown-menu` | artifacts/mockup-sandbox dev ^2.2.1 → 2.2.1; artifacts/run-calculator dev ^2.2.1 → 2.2.1 |
| `@radix-ui/react-hover-card` | artifacts/mockup-sandbox dev ^1.2.1 → 1.2.1; artifacts/run-calculator dev ^1.2.1 → 1.2.1 |
| `@radix-ui/react-label` | artifacts/mockup-sandbox dev ^2.1.17 → 2.1.17; artifacts/run-calculator dev ^2.1.17 → 2.1.17 |
| `@radix-ui/react-menubar` | artifacts/mockup-sandbox dev ^1.2.1 → 1.2.1; artifacts/run-calculator dev ^1.2.1 → 1.2.1 |
| `@radix-ui/react-navigation-menu` | artifacts/mockup-sandbox dev ^1.4.1 → 1.4.1; artifacts/run-calculator dev ^1.4.1 → 1.4.1 |
| `@radix-ui/react-popover` | artifacts/mockup-sandbox dev ^1.3.1 → 1.3.1; artifacts/run-calculator dev ^1.3.1 → 1.3.1 |
| `@radix-ui/react-progress` | artifacts/mockup-sandbox dev ^1.2.1 → 1.2.1; artifacts/run-calculator dev ^1.2.1 → 1.2.1 |
| `@radix-ui/react-radio-group` | artifacts/mockup-sandbox dev ^1.5.1 → 1.5.1; artifacts/run-calculator dev ^1.5.1 → 1.5.1 |
| `@radix-ui/react-scroll-area` | artifacts/mockup-sandbox dev ^1.4.0 → 1.4.0; artifacts/run-calculator dev ^1.4.0 → 1.4.0 |
| `@radix-ui/react-select` | artifacts/mockup-sandbox dev ^2.4.1 → 2.4.1; artifacts/run-calculator dev ^2.4.1 → 2.4.1 |
| `@radix-ui/react-separator` | artifacts/mockup-sandbox dev ^1.2.0 → 1.2.0; artifacts/run-calculator dev ^1.2.0 → 1.2.0 |
| `@radix-ui/react-slider` | artifacts/mockup-sandbox dev ^1.6.1 → 1.6.1; artifacts/run-calculator dev ^1.6.1 → 1.6.1 |
| `@radix-ui/react-slot` | artifacts/mockup-sandbox dev ^1.5.0 → 1.5.0; artifacts/run-calculator dev ^1.5.0 → 1.5.0 |
| `@radix-ui/react-switch` | artifacts/mockup-sandbox dev ^1.4.1 → 1.4.1; artifacts/run-calculator dev ^1.4.1 → 1.4.1 |
| `@radix-ui/react-tabs` | artifacts/mockup-sandbox dev ^1.2.1 → 1.2.1; artifacts/run-calculator dev ^1.2.1 → 1.2.1 |
| `@radix-ui/react-toast` | artifacts/mockup-sandbox dev ^1.3.1 → 1.3.1; artifacts/run-calculator dev ^1.3.1 → 1.3.1 |
| `@radix-ui/react-toggle` | artifacts/mockup-sandbox dev ^1.2.1 → 1.2.1; artifacts/run-calculator dev ^1.2.1 → 1.2.1 |
| `@radix-ui/react-toggle-group` | artifacts/mockup-sandbox dev ^1.2.1 → 1.2.1; artifacts/run-calculator dev ^1.2.1 → 1.2.1 |
| `@radix-ui/react-tooltip` | artifacts/mockup-sandbox dev ^1.4.1 → 1.4.1; artifacts/run-calculator dev ^1.4.1 → 1.4.1 |
| `@replit/vite-plugin-cartographer` | artifacts/mockup-sandbox dev catalog ^0.6.1 → 0.6.1; artifacts/run-calculator dev catalog ^0.6.1 → 0.6.1 |
| `@replit/vite-plugin-dev-banner` | artifacts/run-calculator dev catalog ^0.1.2 → 0.1.2 |
| `@replit/vite-plugin-runtime-error-modal` | artifacts/mockup-sandbox dev catalog ^0.0.6 → 0.0.6; artifacts/run-calculator dev catalog ^0.0.6 → 0.0.6 |
| `@tailwindcss/typography` | artifacts/run-calculator dev ^0.5.20 → 0.5.20 |
| `@tailwindcss/vite` | artifacts/mockup-sandbox dev catalog ^4.3.3 → 4.3.3; artifacts/run-calculator dev catalog ^4.3.3 → 4.3.3 |
| `@tanstack/react-query` | artifacts/run-calculator dev catalog ^5.104.2 → 5.104.2; lib/api-client-react dep catalog ^5.104.2 → 5.104.2 |
| `@testing-library/dom` | artifacts/run-calculator dev ^10.4.2 → 10.4.2 |
| `@testing-library/react` | artifacts/run-calculator dev ^16.3.3 → 16.3.3 |
| `@testing-library/user-event` | artifacts/run-calculator dev ^14.6.8 → 14.6.8 |
| `@types/cookie-parser` | artifacts/api-server dev ^1.4.10 → 1.4.10 |
| `@types/cors` | artifacts/api-server dev ^2.8.19 → 2.8.19 |
| `@types/express` | artifacts/api-server dev ^5.0.6 → 5.0.6 |
| `@types/node` | artifacts/api-server dev catalog ^26.6.5 → 26.6.5; artifacts/mockup-sandbox dev catalog ^26.6.5 → 26.6.5; artifacts/run-calculator dev catalog ^26.6.5 → 26.6.5; lib/ai-evaluation dev catalog ^26.6.5 → 26.6.5; lib/corpus-harness dev catalog ^26.6.5 → 26.6.5; lib/db dev catalog ^26.6.5 → 26.6.5; lib/distill-dataset dev catalog ^26.6.5 → 26.6.5; lib/integrations-openai-ai-server dev catalog ^26.6.5 → 26.6.5; scripts dev catalog ^26.6.5 → 26.6.5 |
| `@types/pg` | artifacts/api-server dev ^8.23.1 → 8.23.1; artifacts/run-calculator dev ^8.23.1 → 8.23.1; lib/db dev ^8.23.1 → 8.23.1; scripts dep ^8.23.1 → 8.23.1 |
| `@types/react` | artifacts/mockup-sandbox dev catalog ^19.3.0 → 19.3.0; artifacts/run-calculator dev catalog ^19.3.0 → 19.3.0; lib/onboarding dev catalog ^19.3.0 → 19.3.0 |
| `@types/react-dom` | artifacts/mockup-sandbox dev catalog ^19.3.0 → 19.3.0; artifacts/run-calculator dev catalog ^19.3.0 → 19.3.0 |
| `@types/web-push` | artifacts/api-server dev ^3.6.4 → 3.6.4 |
| `@vitejs/plugin-react` | artifacts/mockup-sandbox dev catalog ^6.1.2 → 6.1.2; artifacts/run-calculator dev catalog ^6.1.2 → 6.1.2 |
| `axe-core` | artifacts/run-calculator dev ^4.14.0 → 4.14.0 |
| `chokidar` | artifacts/mockup-sandbox dev ^5.0.0 → 5.0.0 |
| `class-variance-authority` | artifacts/mockup-sandbox dev catalog ^0.7.1 → 0.7.1; artifacts/run-calculator dev catalog ^0.7.1 → 0.7.1 |
| `clsx` | artifacts/mockup-sandbox dev catalog ^2.1.1 → 2.1.1; artifacts/run-calculator dev catalog ^2.1.1 → 2.1.1 |
| `cmdk` | artifacts/mockup-sandbox dev ^1.1.1 → 1.1.1; artifacts/run-calculator dev ^1.1.1 → 1.1.1 |
| `cookie-parser` | artifacts/api-server dep ^1.4.7 → 1.4.7 |
| `cors` | artifacts/api-server dep ^2.8.6 → 2.8.6 |
| `date-fns` | artifacts/mockup-sandbox dev ^4.4.0 → 4.4.0; artifacts/run-calculator dev ^4.4.0 → 4.4.0 |
| `drizzle-kit` | lib/db dev ^0.31.11 → 0.31.11 |
| `drizzle-orm` | artifacts/api-server dep catalog ^0.45.4 → 0.45.4; lib/db dep catalog ^0.45.4 → 0.45.4 |
| `drizzle-zod` | lib/db dep ^0.8.3 → 0.8.3 |
| `embla-carousel-react` | artifacts/mockup-sandbox dev ^8.6.0 → 8.6.0; artifacts/run-calculator dev ^8.6.0 → 8.6.0 |
| `esbuild` | artifacts/api-server dev ^0.28.2 → 0.28.2 |
| `esbuild-plugin-pino` | artifacts/api-server dev ^2.3.3 → 2.3.3 |
| `express` | artifacts/api-server dep ^5.3.0 → 5.3.0 |
| `fast-check` | lib/ai-evaluation dev ^4.10.2 → 4.10.2; scripts dev ^4.10.2 → 4.10.2 |
| `framer-motion` | artifacts/mockup-sandbox dev catalog ^13.5.1 → 13.5.1; artifacts/run-calculator dev catalog ^13.5.1 → 13.5.1 |
| `github-actionlint` | scripts dev 1.7.12 → 1.7.12 |
| `heic2any` | artifacts/run-calculator dev ^0.0.4 → 0.0.4 |
| `input-otp` | artifacts/mockup-sandbox dev ^1.5.0 → 1.5.0; artifacts/run-calculator dev ^1.5.0 → 1.5.0 |
| `jsdom` | artifacts/run-calculator dev ^30.1.2 → 30.1.2 |
| `lucide-react` | artifacts/mockup-sandbox dev catalog ^1.56.0 → 1.56.0; artifacts/run-calculator dev catalog ^1.56.0 → 1.56.0 |
| `next-themes` | artifacts/mockup-sandbox dev ^0.4.6 → 0.4.6; artifacts/run-calculator dev ^0.4.6 → 0.4.6 |
| `openai` | lib/integrations-openai-ai-server dep ^7.32.0 → 7.32.0 |
| `orval` | lib/api-spec dev 8.40.0 → 8.40.0 |
| `p-limit` | lib/integrations-openai-ai-server dep ^7.3.3 → 7.3.3 |
| `p-retry` | lib/integrations-openai-ai-server dep ^8.0.1 → 8.0.1 |
| `pg` | artifacts/api-server dev ^8.23.1 → 8.23.1; artifacts/run-calculator dev ^8.23.1 → 8.23.1; lib/db dep ^8.23.1 → 8.23.1; scripts dep ^8.23.1 → 8.23.1 |
| `pino` | artifacts/api-server dep ^10.4.0 → 10.4.0 |
| `pino-http` | artifacts/api-server dep ^11.0.0 → 11.0.0 |
| `pino-pretty` | artifacts/api-server dev ^13.2.0 → 13.2.0 |
| `prettier` | . dev ^3.9.10 → 3.9.10 |
| `react` | artifacts/mockup-sandbox dev catalog 19.3.0 → 19.3.0; artifacts/run-calculator dev catalog 19.3.0 → 19.3.0; lib/api-client-react peer >=18 → workspace React 19.3.0; lib/onboarding dev catalog 19.3.0 → 19.3.0; lib/onboarding peer >=18 → workspace React 19.3.0 |
| `react-day-picker` | artifacts/mockup-sandbox dev ^10.0.2 → 10.0.2; artifacts/run-calculator dev ^10.0.2 → 10.0.2 |
| `react-dom` | artifacts/mockup-sandbox dev catalog 19.3.0 → 19.3.0; artifacts/run-calculator dev catalog 19.3.0 → 19.3.0 |
| `react-hook-form` | artifacts/mockup-sandbox dev ^7.90.0 → 7.90.0; artifacts/run-calculator dev ^7.90.0 → 7.90.0 |
| `react-icons` | artifacts/run-calculator dev ^5.7.0 → 5.7.0 |
| `react-resizable-panels` | artifacts/mockup-sandbox dev ^4.14.5 → 4.14.5; artifacts/run-calculator dev ^4.14.5 → 4.14.5 |
| `recharts` | artifacts/mockup-sandbox dev ^3.10.1 → 3.10.1; artifacts/run-calculator dev ^3.10.1 → 3.10.1 |
| `sonner` | artifacts/mockup-sandbox dev ^2.0.8 → 2.0.8; artifacts/run-calculator dev ^2.0.8 → 2.0.8 |
| `tailwind-merge` | artifacts/mockup-sandbox dev catalog ^3.7.0 → 3.7.0; artifacts/run-calculator dev catalog ^3.7.0 → 3.7.0 |
| `tailwindcss` | artifacts/mockup-sandbox dev catalog ^4.3.3 → 4.3.3; artifacts/run-calculator dev catalog ^4.3.3 → 4.3.3 |
| `tailwindcss-animate` | artifacts/mockup-sandbox dev ^1.0.7 → 1.0.7 |
| `thread-stream` | artifacts/api-server dev 4.2.0 → 4.2.0 |
| `tsx` | lib/corpus-harness dev catalog ^4.23.15 → 4.23.15; scripts dev catalog ^4.23.15 → 4.23.15 |
| `tw-animate-css` | artifacts/mockup-sandbox dev ^1.4.0 → 1.4.0; artifacts/run-calculator dev ^1.4.0 → 1.4.0 |
| `typedoc-plugin-coverage` | lib/api-spec dev 4.0.3 → 4.0.3 |
| `typescript` | . dev ~6.0.3 → 6.0.3; lib/api-spec dev 6.0.3 → 6.0.3 |
| `typescript-api-v6` | lib/typescript-api-v6 dep npm:typescript@6.0.3 → typescript@6.0.3 |
| `typescript-native` | . dev npm:typescript@7.0.2 → typescript@7.0.2 |
| `vaul` | artifacts/mockup-sandbox dev ^1.1.2 → 1.1.2; artifacts/run-calculator dev ^1.1.2 → 1.1.2 |
| `vite` | artifacts/mockup-sandbox dev ^8.3.4 → 8.3.4; artifacts/run-calculator dev ^8.3.4 → 8.3.4 |
| `vite-plugin-pwa` | artifacts/run-calculator dev ^1.3.0 → 1.3.0 |
| `vitest` | artifacts/api-server dev 5.0.4 → 5.0.4; artifacts/run-calculator dev 5.0.4 → 5.0.4; lib/ai-evaluation dev ^4.1.9 → 5.0.4; lib/anomaly dev 5.0.4 → 5.0.4; lib/api-zod dev 5.0.4 → 5.0.4; lib/cheese-import dev 5.0.4 → 5.0.4; lib/cheese-recipes dev 5.0.4 → 5.0.4; lib/cheese-reconcile dev 5.0.4 → 5.0.4; lib/corpus-harness dev 5.0.4 → 5.0.4; lib/cycle-count dev 5.0.4 → 5.0.4; lib/day-summary dev 5.0.4 → 5.0.4; lib/distill-dataset dev 5.0.4 → 5.0.4; lib/downtime-trends dev 5.0.4 → 5.0.4; lib/formula-guard dev 5.0.4 → 5.0.4; lib/freezer-pull dev 5.0.4 → 5.0.4; lib/incident-cluster dev 5.0.4 → 5.0.4; lib/ingredient-catalog dev 5.0.4 → 5.0.4; lib/inventory-math dev 5.0.4 → 5.0.4; lib/live-calc dev 5.0.4 → 5.0.4; lib/merge-suggest dev 5.0.4 → 5.0.4; lib/mix-reconcile dev 5.0.4 → 5.0.4; lib/mixes dev 5.0.4 → 5.0.4; lib/name-match dev 5.0.4 → 5.0.4; lib/named-recipes dev 5.0.4 → 5.0.4; lib/premix-import dev 5.0.4 → 5.0.4; lib/production-rules dev 5.0.4 → 5.0.4; lib/profile-cleanup dev 5.0.4 → 5.0.4; lib/recipe-guide-import dev 5.0.4 → 5.0.4; lib/schedule-move dev 5.0.4 → 5.0.4; lib/schedule-optimize dev 5.0.4 → 5.0.4; lib/scheduled-recipe-check dev 5.0.4 → 5.0.4; lib/setup-math-check dev 5.0.4 → 5.0.4; lib/shipping-import dev 5.0.4 → 5.0.4; lib/spec-export dev 5.0.4 → 5.0.4; lib/spec-import dev 5.0.4 → 5.0.4; lib/spec-reconcile dev 5.0.4 → 5.0.4; lib/sync-contract dev 5.0.4 → 5.0.4; scripts dev ^4.1.9 → 5.0.4 |
| `web-push` | artifacts/api-server dep ^3.6.7 → 3.6.7 |
| `workbox-expiration` | artifacts/run-calculator dev 7.4.1 → 7.4.1 |
| `workbox-precaching` | artifacts/run-calculator dev 7.4.1 → 7.4.1 |
| `workbox-routing` | artifacts/run-calculator dev 7.4.1 → 7.4.1 |
| `workbox-strategies` | artifacts/run-calculator dev 7.4.1 → 7.4.1 |
| `workbox-window` | artifacts/run-calculator dev ^7.4.1 → 7.4.1 |
| `wouter` | artifacts/run-calculator dev ^3.13.0 → 3.13.0 |
| `xlsx` | artifacts/run-calculator dev npm:@e965/xlsx@^0.20.3 → @e965/xlsx@0.20.3; lib/corpus-harness dep npm:@e965/xlsx@^0.20.3 → @e965/xlsx@0.20.3; lib/spec-export dev npm:@e965/xlsx@^0.20.3 → @e965/xlsx@0.20.3; scripts dep npm:@e965/xlsx@^0.20.3 → @e965/xlsx@0.20.3 |
| `zod` | artifacts/api-server dep catalog ^4.6.7 → 4.6.7; artifacts/mockup-sandbox dev catalog ^4.6.7 → 4.6.7; artifacts/run-calculator dev catalog ^4.6.7 → 4.6.7; lib/api-zod dep catalog ^4.6.7 → 4.6.7; lib/db dep catalog ^4.6.7 → 4.6.7 |
