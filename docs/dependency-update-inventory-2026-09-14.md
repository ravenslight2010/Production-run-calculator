# Workspace dependency update inventory — 2026-09-14

This inventory records the registry snapshot used for the staged workspace
dependency update. The source was `pnpm outdated -r --format json`, run with
the repository's pinned pnpm 11.5.2 toolchain on 2026-09-14. The workspace
minimum release age and all existing overrides remain enabled.

## Applied safe updates

The following direct dependencies were updated within their compatible release
line and the lockfile was regenerated:

- API and server tooling: `@google/genai` 2.18.0 → 2.22.0,
  `http-proxy-middleware` 4.1.1 → 4.2.0, `p-limit` 7.3.0 → 7.3.2,
  `pg` 8.20.0 → 8.23.0, `@types/pg` 8.20.0 → 8.23.1, and
  `esbuild` 0.28.1 → 0.28.2.
- API generation and workspace tooling: `orval` 8.26.0 → 8.32.0,
  `prettier` 3.8.3 → 3.9.6, and `tsx` 4.23.12 → 4.23.13.
- React-compatible UI dependencies: React and React DOM 19.1.0 → 19.3.0,
  React type packages 19.2.x → 19.3.0, TanStack Query 5.100.9 → 5.102.8,
  the Radix UI patch/minor updates, React Hook Form 7.75.0 → 7.88.0,
  Playwright 1.61.1 → 1.63.0, input-otp 1.4.2 → 1.5.0,
  react-icons 5.6.0 → 5.7.0, and wouter 3.10.0 → 3.11.0.
- Build and styling patches: Tailwind CSS and its Vite adapter 4.3.0 →
  4.3.3, tailwind-merge 3.5.0 → 3.7.0, testing-library React 16.3.2 →
  16.3.3, testing-library user-event 14.6.1 → 14.6.7, and sonner 2.0.7 →
  2.0.8. This slice also includes input-otp 1.4.2 → 1.5.0 and
  `@tailwindcss/typography` 0.5.19 → 0.5.20.

## Deferred major or compatibility-sensitive candidates

These candidates remain on their current compatible lines. They require an
isolated migration and are not part of this dependency refresh:

| Candidate                                    | Current line           | Registry candidate     | Reason deferred                                                  |
| -------------------------------------------- | ---------------------- | ---------------------- | ---------------------------------------------------------------- |
| TypeScript                                   | 5.9.x                  | 7.0.2                  | Major compiler and language-service compatibility review         |
| Node types                                   | 25.x                   | 26.5.1                 | Major ambient-runtime type review                                |
| Vite and React plugin                        | 7.x / 5.x              | 8.3.0 / 6.1.1          | Major build pipeline and plugin compatibility review             |
| Vitest                                       | 4.x                    | 5.0.0                  | Major test-runner configuration and environment review           |
| Zod                                          | 3.x                    | 4.6.4                  | Major schema/API compatibility review                            |
| Replit Vite cartographer                     | 0.5.x                  | 0.6.1                  | 0.x minor release treated as a compatibility-sensitive migration |
| `@hookform/resolvers`                        | 3.x                    | 5.9.1                  | Major peer and form-schema adapter review                        |
| `date-fns`, `jsdom`, `openai`, `p-retry`     | 3.x / 29.x / 6.x / 7.x | 4.x / 30.x / 7.x / 8.x | Major API and runtime behavior review                            |
| `pino`, `pino-http`, `thread-stream`         | 9.x / 10.x / 3.x       | 10.x / 11.x / 4.x      | Coupled server logging/runtime migration                         |
| React Day Picker, resizable panels, Recharts | 9.x / 2.x / 2.x        | 10.x / 4.x / 3.x       | UI API and behavior review                                       |
| Framer Motion and Lucide React               | 12.x / 0.x             | 13.x / 1.x             | UI runtime/icon API review                                       |

The production audit overrides, platform-specific optional-package exclusions,
workspace links, AI provider boundaries, and benchmark safety behavior are
unchanged by this staged update.

## Isolated deferred-major decisions

The following isolated slices were evaluated after the compatible refresh. The
accepted slices were intentionally kept independent so a later compatibility
migration can be bisected without mixing unrelated lockfile changes.

| Candidate slice | Decision | Evidence and boundary |
| -------------------------------------------- | ---------------------- | -------------------------------------------- |
| `date-fns` 3.x → 4.4.0 | **Accepted** | The two direct declarations have no source imports; both frontend typechecks and production builds passed, and the full calculator suite passed (2,578 tests). Keep the duplicate-version check in future calendar migrations because React Day Picker currently brings its own date-fns peer line. |
| `framer-motion` 12.x → 13.2.0 | **Accepted** | No source imports or motion components exist in either frontend; both production builds and typechecks passed. Tailwind `motion-safe:*` classes are unrelated and were not changed. |
| `openai` 6.x → 7.15.0 | **Accepted** | The package is a declared compatibility surface but is not imported by application code; the project uses its provider-neutral adapter. Integration typecheck, API typecheck/build, and the API unit suite passed. |
| TypeScript 5.9.x → 7.x | **Deferred** | Project references, generated declarations, bundler module resolution, and Vite/Node configuration compilation need a dedicated compiler migration and full workspace diagnostics review. |
| `@types/node` 25.x → 26.x | **Deferred** | Ambient changes affect server, scripts, and both Vite configurations (`Buffer`, `process`, HTTP middleware, `path`, and `import.meta.dirname`); accept only with all workspace typechecks and the server build. |
| Vite 7/plugin-react 5 → Vite 8/plugin-react 6 | **Deferred** | The apps rely on custom Vite middleware, generated bundle metadata, async Replit plugins, VitePWA `injectManifest`, proxying, and preview host behavior. Require both production builds plus the workbook-boundary check and dev-proxy smoke. |
| Vitest 4/jsdom 29 → Vitest 5/jsdom 30 | **Deferred** | The workspace relies on serialized jsdom calculator tests, API integration shards, and Vitest/Vite config coupling. Require the calculator suite, API unit and integration shards, and browser fixture checks. |
| Zod 3 → 4 | **Deferred** | Generated API schemas explicitly target Zod 3 and application schemas/resolvers are broad. A safe migration must change Orval's Zod target and generated output together, then audit every resolver and API boundary. |
| `@replit/vite-plugin-cartographer` 0.5.x → 0.6.1 | **Deferred** | This 0.x development-only plugin is dynamically loaded by both Vite configurations. Require Replit development-mode startup in both artifacts in addition to production builds before accepting it. |
| `@hookform/resolvers` 3.x → 5.x | **Deferred** | Resolver call sites are unchanged at the surface, but Zod 3 peer compatibility and resolver generic inference affect defaults, coercion, field arrays, reset, and error rendering. Do not combine this with the Zod migration. |
| `pino` 9/`pino-http` 10/`thread-stream` 3 → 10/11/4 | **Deferred as one stack** | Logger APIs appear compatible, but worker transports, redaction, serializers, health-probe silence, bundled workers, and shutdown behavior require coordinated runtime evidence. |
| `p-retry` 7.x → 8.x | **Deferred** | The integration uses `AbortError`, retry counts, exponential backoff, and `onFailedAttempt`; v8 callback context and fail-fast semantics need focused retry tests before acceptance. |
| React Day Picker 9 → 10 | **Deferred** | Both calendar wrappers use v9 component/class-name contracts (`DayButton`, `Root`, `Chevron`, `WeekNumber`, and custom formatters). Requires paired migration plus calendar browser/a11y/visual evidence. |
| React resizable panels 2 → 4 and Recharts 2 → 3 | **Deferred** | These are UI API migrations. The chart wrapper and panel behavior need paired frontend typecheck/build and browser render/resize evidence. |
| Lucide React 0.x → 1.x | **Deferred** | There are many named icon imports and explicit icon types. Audit exports such as `BarChart2`, `CircleAlert`, `Loader2Icon`, and `PanelLeftIcon`, then run both artifact builds and an icon-render smoke before accepting. |
| `chokidar` 4 → 5 | **Deferred** | This registry major was observed during the slice but is not required by the production app contract; it remains isolated until its Node/watch behavior is tested in the mockup development workflow. |

The accepted slices were installed with the workspace lockfile and verified
with `pnpm install --frozen-lockfile`. The accepted changes do not alter API
schemas, generated API clients, application routes, or browser fixture data.
