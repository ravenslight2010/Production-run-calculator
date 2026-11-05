# Dependency override consumer checks — 2026-11-05

## Scope

Behavior-level checks for the five unchanged, exact dependency-override
exceptions. The versions, override rules, optional-package protections, and
audit policy were not changed. Installed package versions below were confirmed
by resolving each consumer's dependency path in the frozen workspace install.

## Consumer results

| Consumer and exception | Resolved package path | Check and result |
|---|---|---|
| Tailwind Typography / `postcss-selector-parser` | `@tailwindcss/typography@0.5.20` → `postcss-selector-parser@7.1.6` | **PASS** — `PORT=5000 BASE_PATH=/ pnpm --filter @workspace/run-calculator exec vite build --config vite.config.ts`. The calculator stylesheet loads `@tailwindcss/typography` through Tailwind's `@plugin` directive; Vite completed the production CSS and app build. |
| Drizzle Kit / `esbuild` | `drizzle-kit@0.31.11` → `esbuild@0.28.2` | **PASS** — `pnpm --filter @workspace/db exec drizzle-kit generate --dialect postgresql --schema ./src/schema/index.ts --out /tmp/task3840-drizzle-generated --name override-consumer-smoke`. Drizzle Kit bundled and read the schema (96 tables) and generated SQL only under `/tmp`; no database connection or schema write was made. |
| `esbuild-plugin-pino` / `esbuild` | `esbuild-plugin-pino@2.3.3` → `esbuild@0.28.2` | **PASS** — `pnpm --filter @workspace/api-server run build`. The API build completed and emitted the Pino worker, file, and pretty bundles. |
| GitHub Actionlint / `adm-zip` | `github-actionlint@1.7.12` → `adm-zip@0.6.1` | **PASS** — the wrapper downloaded and started its pinned Actionlint binary (`github-actionlint --version` reported 1.7.12); direct lint of `ci.yml` passed, then direct lint of all 15 workflow files passed. |
| Vite / `postcss` | `vite@8.3.4` → `postcss@8.5.23` | **PASS** — covered by the calculator Vite production build above, which completed Vite's CSS processing and app/service-worker build. |

The Vite build emitted large-chunk and `inlineDynamicImports`
deprecation warnings; neither stopped the build.

## Additional validation and retained failures

- `CI=true bash scripts/src/run-release-node.sh pnpm install --frozen-lockfile`
  — **PASS**, pnpm 12.8.1; the lockfile was already current.
- `CI=true pnpm --filter @workspace/scripts run test:override-compatibility`
  — **PASS**, all 9 tests; the static check examined 146 consumer edges and
  retained all 5 exact exception tuples.
- `CI=true pnpm run typecheck` — **PASS**.
- `pnpm --filter @workspace/scripts run check:workflows` — **BLOCKED before
  Actionlint** by the Project-run configuration check: `.replit` must launch
  only `release:standard`. The existing task “Make the Project run button match
  its release workflow check” owns that mismatch; `.replit` was not changed
  here.
- Direct Actionlint lint of all 15 workflow files initially found
  ShellCheck `SC2034` for an unused counter in the department-navigation
  web-server readiness loop. The loop now uses an arithmetic counter with the
  same 30-attempt limit, and the full direct Actionlint run passes. The API
  readiness loop was left unchanged.

Two Drizzle Kit command attempts were also retained as diagnostics, not treated
as package compatibility failures: `drizzle-kit check --config` entered its
AWS Data API validation path and reported a missing `database` value, while an
initial `generate` invocation combined `--config` with CLI options that Drizzle
Kit disallows. The successful schema-generation command above avoids both
issues and exercises the resolved `esbuild` consumer path without a database.
An initial direct Actionlint invocation used workflow paths relative to the
scripts package directory; rerunning with absolute workspace paths produced
the lint results above.
