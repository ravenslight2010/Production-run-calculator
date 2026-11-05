# Workspace dependency upgrade-candidate inventory — 2026-11-05

**Snapshot time:** 2026-11-05T05:26:00.118Z (UTC). This is an evidence inventory, not an installation, approval, security certification, or release decision. No package, lockfile, override, toolchain pin, CI setting, or application code was changed.

## Summary

- The repository currently has **51 workspace package manifests plus the root manifest** and **52 corresponding importers** in the application lockfile document. It contains **226 installable external declarations** and **2 peer constraints**, reconciled to **107 registry package identities**. Every non-peer external declaration has a matching lockfile importer resolution; peer constraints are recorded with their workspace React context below.
- The workspace catalog contains **21 entries**; the workspace has **86 override rules**. These were inventoried but not changed. `minimumReleaseAge` remains **1440 minutes (24 hours)** and the existing exclusions remain as configured.
- Registry queries found newer stable candidates for **19 package identities**: **8 patch, 9 minor, and 4 major-version package groups** (the resolver package has stable versions in both 6.x and 7.x). The other **88 identities** have no newer stable patch, minor, or major release than their resolved versions in the registry snapshot. Release candidates under 24 hours are shown with the newest eligible version from the same release class.
- The production audit passed with no known production vulnerabilities at the configured `high` threshold. The full-workspace audit returned **16 advisories** across **six transitive packages** (4 low, 8 moderate, 4 high); those results are documented below. No arbitrary transitive override is proposed.
- Node, TypeScript, and pnpm toolchain decisions remain outside this task. The package-manager pin is **pnpm 12.8.1**; the Node 24 runtime patch is owned by task **#3805** and TypeScript 7 requalification by task **#3803**. The `@types/node` declaration is a type-package patch candidate, not a Node runtime upgrade.

## Method and evidence limits

- Read all root and workspace `package.json` files; excluded generated artifacts, caches, and `node_modules`. Reconciled each external dependency type (`dependencies`, `devDependencies`, `optionalDependencies`, and `peerDependencies`) to the corresponding importer in the **second/application YAML document** of `pnpm-lock.yaml`. The first lockfile document is the pnpm bootstrap/platform graph, not the workspace application dependency graph.
- Expanded each `catalog:` declaration from `pnpm-workspace.yaml`; retained the manifest declaration and the lockfile's resolved package version. npm aliases are shown as the manifest alias and their actual registry package. Workspace/file/link dependencies are not external registry dependencies. Peer dependency ranges are requirements, not installed declarations; the lockfile has no peer entry for those importer manifests, so the matrix shows the workspace React version as context.
- Verified stable version lists and release timestamps from npm registry packuments. Prereleases were excluded. Candidate release age is calculated against the snapshot timestamp above. The configured 24-hour policy was not relaxed; no candidate was installed.
- Ran the pinned `pnpm@12.8.1` through `scripts/src/run-release-node.sh` with Node **24.21.0**. `pnpm outdated -r --format json` exited **1**, its expected status when it finds updates, and returned 21 result entries. Those entries are a signal, not the direct-declaration inventory. Its `wanted` values equaled `current` for all reported entries and its `latest` values lagged the fresh registry for some packages; examples were TanStack Query 5.105.3 vs registry 5.106.0, lucide-react 1.67.0 vs 1.68.0, openai 7.50.0 vs 7.51.0, and react-resizable-panels 4.18.0 vs 4.18.1. Each newest registry release in those examples was under 24 hours old. The direct manifest/catalog ranges were checked separately with semver; no newer candidates were inferred solely from `wanted` or the command's importer list.
- npm registry version evidence is linked per candidate in the matrix. Official release notes were cross-checked for the higher-risk/coupled candidates in [release-note references](#release-notes-and-compatibility-references). Publication timestamps below are npm registry timestamps; where a GitHub release timestamp differs by timezone, registry publish time governs the 24-hour policy check.

## Candidate matrix

The full declaration matrix follows. Candidate versions are newest stable releases per class; where a newest release is younger than 24 hours, it is explicitly blocked and the newest eligible same-class version is given. “Patch,” “minor,” and “major” are SemVer categories; a major candidate is an evaluation only. Existing manifest ranges are included in each declaration and candidate row.

| Registry package | Direct manifest declaration and importer → lockfile resolution | Resolved version(s) | Newer stable candidates (patch / minor / major) |
|---|---|---|---|
| `@axe-core/playwright` | `artifacts/run-calculator` dev ^4.13.0 → 4.14.0 | 4.14.0 | No newer stable patch/minor/major found |
| `@e965/xlsx` | `artifacts/run-calculator` dev npm:@e965/xlsx@^0.20.3 (xlsx → @e965/xlsx) → 0.20.3; `lib/corpus-harness` prod npm:@e965/xlsx@^0.20.3 (xlsx → @e965/xlsx) → 0.20.3; `lib/spec-export` dev npm:@e965/xlsx@^0.20.3 (xlsx → @e965/xlsx) → 0.20.3; `scripts` prod npm:@e965/xlsx@^0.20.3 (xlsx → @e965/xlsx) → 0.20.3 | 0.20.3 | No newer stable patch/minor/major found |
| `@google/genai` | `artifacts/api-server` prod ^2.29.1 → 2.30.0; `lib/integrations-openai-ai-server` prod ^2.29.1 → 2.30.0 | 2.30.0 | 2.30.0→minor: 2.32.0 |
| `@hookform/resolvers` | `artifacts/run-calculator` dev ^5.9.1 → 5.9.2 | 5.9.2 | 5.9.2→major: 7.0.2 |
| `@playwright/test` | `artifacts/run-calculator` dev ^1.64.0 → 1.64.1 | 1.64.1 | No newer stable patch/minor/major found |
| `@radix-ui/react-accordion` | `artifacts/mockup-sandbox` dev ^1.3.1 → 1.3.1; `artifacts/run-calculator` dev ^1.3.1 → 1.3.1 | 1.3.1 | No newer stable patch/minor/major found |
| `@radix-ui/react-alert-dialog` | `artifacts/mockup-sandbox` dev ^1.2.1 → 1.2.1; `artifacts/run-calculator` dev ^1.2.1 → 1.2.1 | 1.2.1 | No newer stable patch/minor/major found |
| `@radix-ui/react-aspect-ratio` | `artifacts/mockup-sandbox` dev ^1.2.0 → 1.2.0; `artifacts/run-calculator` dev ^1.2.0 → 1.2.0 | 1.2.0 | No newer stable patch/minor/major found |
| `@radix-ui/react-avatar` | `artifacts/mockup-sandbox` dev ^1.3.1 → 1.3.1; `artifacts/run-calculator` dev ^1.3.1 → 1.3.1 | 1.3.1 | No newer stable patch/minor/major found |
| `@radix-ui/react-checkbox` | `artifacts/mockup-sandbox` dev ^1.4.1 → 1.4.1; `artifacts/run-calculator` dev ^1.4.1 → 1.4.1 | 1.4.1 | No newer stable patch/minor/major found |
| `@radix-ui/react-collapsible` | `artifacts/mockup-sandbox` dev ^1.2.1 → 1.2.1; `artifacts/run-calculator` dev ^1.2.1 → 1.2.1 | 1.2.1 | No newer stable patch/minor/major found |
| `@radix-ui/react-context-menu` | `artifacts/mockup-sandbox` dev ^2.4.1 → 2.4.1; `artifacts/run-calculator` dev ^2.4.1 → 2.4.1 | 2.4.1 | No newer stable patch/minor/major found |
| `@radix-ui/react-dialog` | `artifacts/mockup-sandbox` dev ^1.3.1 → 1.3.1; `artifacts/run-calculator` dev ^1.3.1 → 1.3.1 | 1.3.1 | No newer stable patch/minor/major found |
| `@radix-ui/react-dropdown-menu` | `artifacts/mockup-sandbox` dev ^2.2.1 → 2.2.1; `artifacts/run-calculator` dev ^2.2.1 → 2.2.1 | 2.2.1 | No newer stable patch/minor/major found |
| `@radix-ui/react-hover-card` | `artifacts/mockup-sandbox` dev ^1.2.1 → 1.2.1; `artifacts/run-calculator` dev ^1.2.1 → 1.2.1 | 1.2.1 | No newer stable patch/minor/major found |
| `@radix-ui/react-label` | `artifacts/mockup-sandbox` dev ^2.1.17 → 2.1.17; `artifacts/run-calculator` dev ^2.1.17 → 2.1.17 | 2.1.17 | No newer stable patch/minor/major found |
| `@radix-ui/react-menubar` | `artifacts/mockup-sandbox` dev ^1.2.1 → 1.2.1; `artifacts/run-calculator` dev ^1.2.1 → 1.2.1 | 1.2.1 | No newer stable patch/minor/major found |
| `@radix-ui/react-navigation-menu` | `artifacts/mockup-sandbox` dev ^1.4.1 → 1.4.1; `artifacts/run-calculator` dev ^1.4.1 → 1.4.1 | 1.4.1 | No newer stable patch/minor/major found |
| `@radix-ui/react-popover` | `artifacts/mockup-sandbox` dev ^1.3.1 → 1.3.1; `artifacts/run-calculator` dev ^1.3.1 → 1.3.1 | 1.3.1 | No newer stable patch/minor/major found |
| `@radix-ui/react-progress` | `artifacts/mockup-sandbox` dev ^1.2.1 → 1.2.1; `artifacts/run-calculator` dev ^1.2.1 → 1.2.1 | 1.2.1 | No newer stable patch/minor/major found |
| `@radix-ui/react-radio-group` | `artifacts/mockup-sandbox` dev ^1.5.1 → 1.5.1; `artifacts/run-calculator` dev ^1.5.1 → 1.5.1 | 1.5.1 | No newer stable patch/minor/major found |
| `@radix-ui/react-scroll-area` | `artifacts/mockup-sandbox` dev ^1.4.0 → 1.4.0; `artifacts/run-calculator` dev ^1.4.0 → 1.4.0 | 1.4.0 | No newer stable patch/minor/major found |
| `@radix-ui/react-select` | `artifacts/mockup-sandbox` dev ^2.4.1 → 2.4.1; `artifacts/run-calculator` dev ^2.4.1 → 2.4.1 | 2.4.1 | No newer stable patch/minor/major found |
| `@radix-ui/react-separator` | `artifacts/mockup-sandbox` dev ^1.2.0 → 1.2.0; `artifacts/run-calculator` dev ^1.2.0 → 1.2.0 | 1.2.0 | No newer stable patch/minor/major found |
| `@radix-ui/react-slider` | `artifacts/mockup-sandbox` dev ^1.6.1 → 1.6.1; `artifacts/run-calculator` dev ^1.6.1 → 1.6.1 | 1.6.1 | No newer stable patch/minor/major found |
| `@radix-ui/react-slot` | `artifacts/mockup-sandbox` dev ^1.5.0 → 1.5.0; `artifacts/run-calculator` dev ^1.5.0 → 1.5.0 | 1.5.0 | No newer stable patch/minor/major found |
| `@radix-ui/react-switch` | `artifacts/mockup-sandbox` dev ^1.4.1 → 1.4.1; `artifacts/run-calculator` dev ^1.4.1 → 1.4.1 | 1.4.1 | No newer stable patch/minor/major found |
| `@radix-ui/react-tabs` | `artifacts/mockup-sandbox` dev ^1.2.1 → 1.2.1; `artifacts/run-calculator` dev ^1.2.1 → 1.2.1 | 1.2.1 | No newer stable patch/minor/major found |
| `@radix-ui/react-toast` | `artifacts/mockup-sandbox` dev ^1.3.1 → 1.3.1; `artifacts/run-calculator` dev ^1.3.1 → 1.3.1 | 1.3.1 | No newer stable patch/minor/major found |
| `@radix-ui/react-toggle` | `artifacts/mockup-sandbox` dev ^1.2.1 → 1.2.1; `artifacts/run-calculator` dev ^1.2.1 → 1.2.1 | 1.2.1 | No newer stable patch/minor/major found |
| `@radix-ui/react-toggle-group` | `artifacts/mockup-sandbox` dev ^1.2.1 → 1.2.1; `artifacts/run-calculator` dev ^1.2.1 → 1.2.1 | 1.2.1 | No newer stable patch/minor/major found |
| `@radix-ui/react-tooltip` | `artifacts/mockup-sandbox` dev ^1.4.1 → 1.4.1; `artifacts/run-calculator` dev ^1.4.1 → 1.4.1 | 1.4.1 | No newer stable patch/minor/major found |
| `@replit/vite-plugin-cartographer` | `artifacts/mockup-sandbox` dev catalog (^0.6.1) → 0.6.1; `artifacts/run-calculator` dev catalog (^0.6.1) → 0.6.1 | 0.6.1 | No newer stable patch/minor/major found |
| `@replit/vite-plugin-dev-banner` | `artifacts/run-calculator` dev catalog (^0.1.2) → 0.1.2 | 0.1.2 | No newer stable patch/minor/major found |
| `@replit/vite-plugin-runtime-error-modal` | `artifacts/mockup-sandbox` dev catalog (^0.0.6) → 0.0.6; `artifacts/run-calculator` dev catalog (^0.0.6) → 0.0.6 | 0.0.6 | No newer stable patch/minor/major found |
| `@tailwindcss/typography` | `artifacts/run-calculator` dev ^0.5.20 → 0.5.20 | 0.5.20 | No newer stable patch/minor/major found |
| `@tailwindcss/vite` | `artifacts/mockup-sandbox` dev catalog (^4.3.3) → 4.3.3; `artifacts/run-calculator` dev catalog (^4.3.3) → 4.3.3 | 4.3.3 | 4.3.3→patch: 4.3.4 |
| `@tanstack/react-query` | `artifacts/run-calculator` dev catalog (^5.104.2) → 5.104.4; `lib/api-client-react` prod catalog (^5.104.2) → 5.104.4 | 5.104.4 | 5.104.4→patch: 5.104.5; 5.104.4→minor: 5.106.0 (<24h; eligible 5.105.3) |
| `@testing-library/dom` | `artifacts/run-calculator` dev ^10.4.2 → 10.4.2 | 10.4.2 | No newer stable patch/minor/major found |
| `@testing-library/react` | `artifacts/run-calculator` dev ^16.3.3 → 16.3.3 | 16.3.3 | No newer stable patch/minor/major found |
| `@testing-library/user-event` | `artifacts/run-calculator` dev ^14.6.8 → 14.6.8 | 14.6.8 | No newer stable patch/minor/major found |
| `@types/cookie-parser` | `artifacts/api-server` dev ^1.4.10 → 1.4.10 | 1.4.10 | No newer stable patch/minor/major found |
| `@types/cors` | `artifacts/api-server` dev ^2.8.19 → 2.8.19 | 2.8.19 | No newer stable patch/minor/major found |
| `@types/express` | `artifacts/api-server` dev ^5.0.6 → 5.0.6 | 5.0.6 | No newer stable patch/minor/major found |
| `@types/node` | `artifacts/api-server` dev catalog (^26.6.5) → 26.6.5; `artifacts/mockup-sandbox` dev catalog (^26.6.5) → 26.6.5; `artifacts/run-calculator` dev catalog (^26.6.5) → 26.6.5; `lib/ai-evaluation` dev catalog (^26.6.5) → 26.6.5; `lib/corpus-harness` dev catalog (^26.6.5) → 26.6.5; `lib/db` dev catalog (^26.6.5) → 26.6.5; `lib/distill-dataset` dev catalog (^26.6.5) → 26.6.5; `lib/integrations-openai-ai-server` dev catalog (^26.6.5) → 26.6.5; `scripts` dev catalog (^26.6.5) → 26.6.5 | 26.6.5 | 26.6.5→patch: 26.6.6 |
| `@types/pg` | `artifacts/api-server` dev ^8.23.1 → 8.23.1; `artifacts/run-calculator` dev ^8.23.1 → 8.23.1; `lib/db` dev ^8.23.1 → 8.23.1; `scripts` prod ^8.23.1 → 8.23.1 | 8.23.1 | No newer stable patch/minor/major found |
| `@types/react` | `artifacts/mockup-sandbox` dev catalog (^19.3.0) → 19.3.0; `artifacts/run-calculator` dev catalog (^19.3.0) → 19.3.0; `lib/onboarding` dev catalog (^19.3.0) → 19.3.0 | 19.3.0 | No newer stable patch/minor/major found |
| `@types/react-dom` | `artifacts/mockup-sandbox` dev catalog (^19.3.0) → 19.3.0; `artifacts/run-calculator` dev catalog (^19.3.0) → 19.3.0 | 19.3.0 | No newer stable patch/minor/major found |
| `@types/web-push` | `artifacts/api-server` dev ^3.6.4 → 3.6.4 | 3.6.4 | No newer stable patch/minor/major found |
| `@vitejs/plugin-react` | `artifacts/mockup-sandbox` dev catalog (^6.1.2) → 6.1.2; `artifacts/run-calculator` dev catalog (^6.1.2) → 6.1.2 | 6.1.2 | 6.1.2→minor: 6.2.1 |
| `chokidar` | `artifacts/mockup-sandbox` dev ^5.0.0 → 5.0.0 | 5.0.0 | 5.0.0→major: 6.0.0 |
| `class-variance-authority` | `artifacts/mockup-sandbox` dev catalog (^0.7.1) → 0.7.1; `artifacts/run-calculator` dev catalog (^0.7.1) → 0.7.1 | 0.7.1 | No newer stable patch/minor/major found |
| `clsx` | `artifacts/mockup-sandbox` dev catalog (^2.1.1) → 2.1.1; `artifacts/run-calculator` dev catalog (^2.1.1) → 2.1.1 | 2.1.1 | No newer stable patch/minor/major found |
| `cmdk` | `artifacts/mockup-sandbox` dev ^1.1.1 → 1.1.1; `artifacts/run-calculator` dev ^1.1.1 → 1.1.1 | 1.1.1 | No newer stable patch/minor/major found |
| `cookie-parser` | `artifacts/api-server` prod ^1.4.7 → 1.4.7 | 1.4.7 | No newer stable patch/minor/major found |
| `cors` | `artifacts/api-server` prod ^2.8.6 → 2.8.6 | 2.8.6 | No newer stable patch/minor/major found |
| `drizzle-kit` | `lib/db` dev ^0.31.11 → 0.31.11 | 0.31.11 | No newer stable patch/minor/major found |
| `drizzle-orm` | `artifacts/api-server` prod catalog (^0.45.4) → 0.45.4; `lib/db` prod catalog (^0.45.4) → 0.45.4 | 0.45.4 | No newer stable patch/minor/major found |
| `drizzle-zod` | `lib/db` prod ^0.8.3 → 0.8.3 | 0.8.3 | No newer stable patch/minor/major found |
| `embla-carousel-react` | `artifacts/mockup-sandbox` dev ^8.6.0 → 8.6.0; `artifacts/run-calculator` dev ^8.6.0 → 8.6.0 | 8.6.0 | No newer stable patch/minor/major found |
| `esbuild` | `artifacts/api-server` dev ^0.28.2 → 0.28.2 | 0.28.2 | No newer stable patch/minor/major found |
| `esbuild-plugin-pino` | `artifacts/api-server` dev ^2.3.3 → 2.3.3 | 2.3.3 | No newer stable patch/minor/major found |
| `express` | `artifacts/api-server` prod ^5.3.0 → 5.3.0 | 5.3.0 | No newer stable patch/minor/major found |
| `fast-check` | `lib/ai-evaluation` dev ^4.10.2 → 4.10.2; `scripts` dev ^4.10.2 → 4.10.2 | 4.10.2 | No newer stable patch/minor/major found |
| `github-actionlint` | `scripts` dev 1.7.12 → 1.7.12 | 1.7.12 | No newer stable patch/minor/major found |
| `heic2any` | `artifacts/run-calculator` dev ^0.0.4 → 0.0.4 | 0.0.4 | No newer stable patch/minor/major found |
| `input-otp` | `artifacts/mockup-sandbox` dev ^1.5.0 → 1.5.0; `artifacts/run-calculator` dev ^1.5.0 → 1.5.0 | 1.5.0 | No newer stable patch/minor/major found |
| `jsdom` | `artifacts/run-calculator` dev ^30.1.2 → 30.1.3 | 30.1.3 | No newer stable patch/minor/major found |
| `lucide-react` | `artifacts/mockup-sandbox` dev catalog (^1.56.0) → 1.59.0; `artifacts/run-calculator` dev catalog (^1.56.0) → 1.59.0 | 1.59.0 | 1.59.0→minor: 1.68.0 (<24h; eligible 1.67.0) |
| `next-themes` | `artifacts/mockup-sandbox` dev ^0.4.6 → 0.4.6; `artifacts/run-calculator` dev ^0.4.6 → 0.4.6 | 0.4.6 | No newer stable patch/minor/major found |
| `openai` | `lib/integrations-openai-ai-server` prod ^7.15.0 → 7.38.0 | 7.38.0 | 7.38.0→minor: 7.51.0 (<24h; eligible 7.50.0) |
| `orval` | `lib/api-spec` dev 8.43.0 → 8.43.0 | 8.43.0 | 8.43.0→minor: 8.46.0 |
| `p-limit` | `lib/integrations-openai-ai-server` prod ^7.3.3 → 7.3.3 | 7.3.3 | No newer stable patch/minor/major found |
| `p-retry` | `lib/integrations-openai-ai-server` prod ^8.0.1 → 8.0.1 | 8.0.1 | 8.0.1→major: 9.0.0 |
| `pg` | `artifacts/api-server` dev ^8.23.1 → 8.23.1; `artifacts/run-calculator` dev ^8.23.1 → 8.23.1; `lib/db` prod ^8.23.1 → 8.23.1; `scripts` prod ^8.23.1 → 8.23.1 | 8.23.1 | No newer stable patch/minor/major found |
| `pino` | `artifacts/api-server` prod ^10.4.0 → 10.4.0 | 10.4.0 | No newer stable patch/minor/major found |
| `pino-http` | `artifacts/api-server` prod ^11.0.0 → 11.0.0 | 11.0.0 | No newer stable patch/minor/major found |
| `pino-pretty` | `artifacts/api-server` dev ^13.2.0 → 13.2.0 | 13.2.0 | No newer stable patch/minor/major found |
| `prettier` | `.` dev ^3.9.10 → 3.9.10 | 3.9.10 | No newer stable patch/minor/major found |
| `react` | `artifacts/mockup-sandbox` dev catalog (19.3.1) → 19.3.1; `artifacts/run-calculator` dev catalog (19.3.1) → 19.3.1; `lib/onboarding` dev catalog (19.3.1) → 19.3.1; `lib/api-client-react` peer >=18 → workspace React 19.3.1 context; `lib/onboarding` peer >=18 → workspace React 19.3.1 context | 19.3.1 | No newer stable patch/minor/major found |
| `react-day-picker` | `artifacts/mockup-sandbox` dev ^10.0.2 → 10.0.2; `artifacts/run-calculator` dev ^10.0.2 → 10.0.2 | 10.0.2 | No newer stable patch/minor/major found |
| `react-dom` | `artifacts/mockup-sandbox` dev catalog (19.3.1) → 19.3.1; `artifacts/run-calculator` dev catalog (19.3.1) → 19.3.1 | 19.3.1 | No newer stable patch/minor/major found |
| `react-hook-form` | `artifacts/mockup-sandbox` dev ^7.90.0 → 7.90.0; `artifacts/run-calculator` dev ^7.90.0 → 7.90.0 | 7.90.0 | 7.90.0→minor: 7.91.0 |
| `react-resizable-panels` | `artifacts/mockup-sandbox` dev ^4.14.5 → 4.14.5; `artifacts/run-calculator` dev ^4.14.5 → 4.14.5 | 4.14.5 | 4.14.5→patch: 4.14.8; 4.14.5→minor: 4.18.1 (<24h; eligible 4.18.0) |
| `recharts` | `artifacts/mockup-sandbox` dev ^3.10.1 → 3.10.1; `artifacts/run-calculator` dev ^3.10.1 → 3.10.1 | 3.10.1 | No newer stable patch/minor/major found |
| `sonner` | `artifacts/mockup-sandbox` dev ^2.0.8 → 2.0.8; `artifacts/run-calculator` dev ^2.0.8 → 2.0.8 | 2.0.8 | No newer stable patch/minor/major found |
| `tailwind-merge` | `artifacts/mockup-sandbox` dev catalog (^3.7.0) → 3.7.0; `artifacts/run-calculator` dev catalog (^3.7.0) → 3.7.0 | 3.7.0 | No newer stable patch/minor/major found |
| `tailwindcss` | `artifacts/mockup-sandbox` dev catalog (^4.3.3) → 4.3.3; `artifacts/run-calculator` dev catalog (^4.3.3) → 4.3.3 | 4.3.3 | 4.3.3→patch: 4.3.4 |
| `thread-stream` | `artifacts/api-server` dev 4.2.0 → 4.2.0 | 4.2.0 | 4.2.0→patch: 4.2.1 |
| `tsx` | `lib/corpus-harness` dev catalog (^4.23.15) → 4.23.15; `scripts` dev catalog (^4.23.15) → 4.23.15 | 4.23.15 | No newer stable patch/minor/major found |
| `tw-animate-css` | `artifacts/mockup-sandbox` dev ^1.4.0 → 1.4.0; `artifacts/run-calculator` dev ^1.4.0 → 1.4.0 | 1.4.0 | No newer stable patch/minor/major found |
| `typedoc` | `lib/api-spec` dev 0.28.20 → 0.28.20 | 0.28.20 | No newer stable patch/minor/major found |
| `typedoc-plugin-coverage` | `lib/api-spec` dev 4.0.3 → 4.0.3 | 4.0.3 | No newer stable patch/minor/major found |
| `typedoc-plugin-markdown` | `lib/api-spec` dev 4.14.0 → 4.14.0 | 4.14.0 | 4.14.0→patch: 4.14.1 |
| `typescript` | `.` dev ~6.0.3 → 6.0.3; `.` dev npm:typescript@7.0.2 (typescript-native → typescript) → 7.0.2; `lib/api-spec` dev 6.0.3 → 6.0.3; `lib/typescript-api-v6` prod npm:typescript@6.0.3 (typescript-api-v6 → typescript) → 6.0.3 | 6.0.3, 7.0.2 | 6.0.3→major: 7.0.2 |
| `vaul` | `artifacts/mockup-sandbox` dev ^1.1.2 → 1.1.2; `artifacts/run-calculator` dev ^1.1.2 → 1.1.2 | 1.1.2 | No newer stable patch/minor/major found |
| `vite` | `artifacts/mockup-sandbox` dev ^8.3.4 → 8.3.4; `artifacts/run-calculator` dev ^8.3.4 → 8.3.4 | 8.3.4 | 8.3.4→patch: 8.3.5 |
| `vite-plugin-pwa` | `artifacts/run-calculator` dev 2.0.0 → 2.0.0 | 2.0.0 | No newer stable patch/minor/major found |
| `vitest` | `artifacts/api-server` dev 5.0.5 → 5.0.5; `artifacts/run-calculator` dev 5.0.5 → 5.0.5; `lib/ai-evaluation` dev ^5.0.5 → 5.0.5; `lib/anomaly` dev 5.0.5 → 5.0.5; `lib/api-zod` dev 5.0.5 → 5.0.5; `lib/cheese-import` dev 5.0.5 → 5.0.5; `lib/cheese-recipes` dev 5.0.5 → 5.0.5; `lib/cheese-reconcile` dev 5.0.5 → 5.0.5; `lib/corpus-harness` dev 5.0.5 → 5.0.5; `lib/day-summary` dev 5.0.5 → 5.0.5; `lib/distill-dataset` dev 5.0.5 → 5.0.5; `lib/downtime-trends` dev 5.0.5 → 5.0.5; `lib/formula-guard` dev 5.0.5 → 5.0.5; `lib/freezer-pull` dev 5.0.5 → 5.0.5; `lib/incident-cluster` dev 5.0.5 → 5.0.5; `lib/ingredient-catalog` dev 5.0.5 → 5.0.5; `lib/integrations-openai-ai-server` dev 5.0.5 → 5.0.5; `lib/inventory-math` dev 5.0.5 → 5.0.5; `lib/live-calc` dev 5.0.5 → 5.0.5; `lib/merge-suggest` dev 5.0.5 → 5.0.5; `lib/mix-reconcile` dev 5.0.5 → 5.0.5; `lib/mixes` dev 5.0.5 → 5.0.5; `lib/name-match` dev 5.0.5 → 5.0.5; `lib/named-recipes` dev 5.0.5 → 5.0.5; `lib/premix-import` dev 5.0.5 → 5.0.5; `lib/production-rules` dev 5.0.5 → 5.0.5; `lib/profile-cleanup` dev 5.0.5 → 5.0.5; `lib/recipe-guide-import` dev 5.0.5 → 5.0.5; `lib/schedule-move` dev 5.0.5 → 5.0.5; `lib/schedule-optimize` dev 5.0.5 → 5.0.5; `lib/scheduled-recipe-check` dev 5.0.5 → 5.0.5; `lib/setup-math-check` dev 5.0.5 → 5.0.5; `lib/shipping-import` dev 5.0.5 → 5.0.5; `lib/spec-export` dev 5.0.5 → 5.0.5; `lib/spec-import` dev 5.0.5 → 5.0.5; `lib/spec-reconcile` dev 5.0.5 → 5.0.5; `lib/sync-contract` dev 5.0.5 → 5.0.5; `scripts` dev ^5.0.5 → 5.0.5 | 5.0.5 | 5.0.5→minor: 5.1.0 |
| `web-push` | `artifacts/api-server` prod ^3.6.7 → 3.6.7 | 3.6.7 | No newer stable patch/minor/major found |
| `workbox-expiration` | `artifacts/run-calculator` dev 7.4.1 → 7.4.1 | 7.4.1 | No newer stable patch/minor/major found |
| `workbox-precaching` | `artifacts/run-calculator` dev 7.4.1 → 7.4.1 | 7.4.1 | No newer stable patch/minor/major found |
| `workbox-routing` | `artifacts/run-calculator` dev 7.4.1 → 7.4.1 | 7.4.1 | No newer stable patch/minor/major found |
| `workbox-strategies` | `artifacts/run-calculator` dev 7.4.1 → 7.4.1 | 7.4.1 | No newer stable patch/minor/major found |
| `workbox-window` | `artifacts/run-calculator` dev ^7.4.1 → 7.4.1 | 7.4.1 | No newer stable patch/minor/major found |
| `wouter` | `artifacts/run-calculator` dev ^3.13.0 → 3.13.0 | 3.13.0 | No newer stable patch/minor/major found |
| `zod` | `artifacts/api-server` prod catalog (^4.6.7) → 4.6.7; `artifacts/run-calculator` dev catalog (^4.6.7) → 4.6.7; `lib/api-zod` prod catalog (^4.6.7) → 4.6.7; `lib/db` prod catalog (^4.6.7) → 4.6.7 | 4.6.7 | No newer stable patch/minor/major found |

### Candidate evidence and risk notes

Each candidate's age and registry version evidence are listed here. The “range” column describes the effective current manifest declaration; exact pins and outside-range candidates require an explicit manifest decision. For shared catalog consumers, the importer list shows every affected direct consumer.

| Package | Current → candidate and release-age status | Affected importer(s) | Existing range / compatibility signal | Registry evidence |
|---|---|---|---|---|
| @google/genai | 2.30.0 → **2.32.0 (published 2026-10-29T06:40:53.230Z; age 6d 22h)** (minor) | `artifacts/api-server`, `lib/integrations-openai-ai-server` | ^2.29.1; existing range accepts candidate; Node >=20.0.0; peers: @modelcontextprotocol/sdk ^1.25.2 | [registry metadata](https://registry.npmjs.org/%40google%2Fgenai/2.32.0) |
| @hookform/resolvers | 5.9.2 → **7.0.2 (published 2026-11-03T15:46:30.639Z; age 1d 13h)** (major) | `artifacts/run-calculator` | ^5.9.1; major evaluation; no automatic recommendation; No Node engine declared; peers: zod ^3.25.0 \|\| ^4.0.0, react-hook-form ^7.55.0 | [registry metadata](https://registry.npmjs.org/%40hookform%2Fresolvers/7.0.2) |
| @tailwindcss/vite | 4.3.3 → **4.3.4 (published 2026-11-02T21:30:06.195Z; age 2d 7h)** (patch) | `artifacts/mockup-sandbox`, `artifacts/run-calculator` | ^4.3.3; existing range accepts candidate; No Node engine declared; peers: vite ^5.2.0 \|\| ^6 \|\| ^7 \|\| ^8 | [registry metadata](https://registry.npmjs.org/%40tailwindcss%2Fvite/4.3.4) |
| @tanstack/react-query | 5.104.4 → **5.104.5 (published 2026-10-19T16:57:50.440Z; age 16d 12h)** (patch) | `artifacts/run-calculator`, `lib/api-client-react` | ^5.104.2; existing range accepts candidate; No Node engine declared; peers: react ^18 \|\| ^19, @types/react ^18 \|\| ^19 | [registry metadata](https://registry.npmjs.org/%40tanstack%2Freact-query/5.104.5) |
| @tanstack/react-query | 5.104.4 → **5.105.3 (published 2026-11-02T20:39:13.878Z; age 2d 8h) — newest 5.106.0 published 2026-11-04T20:13:09.653Z, age 0d 9h, blocked by 24h policy** (minor) | `artifacts/run-calculator`, `lib/api-client-react` | ^5.104.2; existing range accepts candidate; No Node engine declared; peers: react ^18 \|\| ^19, @types/react ^18 \|\| ^19 | [registry metadata](https://registry.npmjs.org/%40tanstack%2Freact-query/5.106.0) |
| @types/node | 26.6.5 → **26.6.6 (published 2026-10-28T18:36:36.455Z; age 7d 10h)** (patch) | `artifacts/api-server`, `artifacts/mockup-sandbox`, `artifacts/run-calculator`, `lib/ai-evaluation`, `lib/corpus-harness`, `lib/db`, `lib/distill-dataset`, `lib/integrations-openai-ai-server`, `scripts` | ^26.6.5; existing range accepts candidate; No Node engine declared | [registry metadata](https://registry.npmjs.org/%40types%2Fnode/26.6.6) |
| @vitejs/plugin-react | 6.1.2 → **6.2.1 (published 2026-11-02T09:18:16.564Z; age 2d 20h)** (minor) | `artifacts/mockup-sandbox`, `artifacts/run-calculator` | ^6.1.2; existing range accepts candidate; Node ^20.19.0 \|\| >=22.12.0; peers: vite ^8.0.0 | [registry metadata](https://registry.npmjs.org/%40vitejs%2Fplugin-react/6.2.1) |
| chokidar | 5.0.0 → **6.0.0 (published 2026-10-19T20:52:41.519Z; age 16d 8h)** (major) | `artifacts/mockup-sandbox` | ^5.0.0; major evaluation; no automatic recommendation; Node >= 22.22 | [registry metadata](https://registry.npmjs.org/chokidar/6.0.0) |
| lucide-react | 1.59.0 → **1.67.0 (published 2026-11-03T06:12:32.280Z; age 1d 23h) — newest 1.68.0 published 2026-11-04T06:10:53.831Z, age 0d 23h, blocked by 24h policy** (minor) | `artifacts/mockup-sandbox`, `artifacts/run-calculator` | ^1.56.0; existing range accepts candidate; No Node engine declared; peers: react ^16.5.1 \|\| ^17.0.0 \|\| ^18.0.0 \|\| ^19.0.0, @types/react * | [registry metadata](https://registry.npmjs.org/lucide-react/1.68.0) |
| openai | 7.38.0 → **7.50.0 (published 2026-11-04T02:32:43.226Z; age 1d 2h) — newest 7.51.0 published 2026-11-05T01:05:02.540Z, age 0d 4h, blocked by 24h policy** (minor) | `lib/integrations-openai-ai-server` | ^7.15.0; existing range accepts candidate; Node >=22.0.0; peers: ws ^8.21.0, zod ^3.25 \|\| ^4.0, undici >=5 <9 | [registry metadata](https://registry.npmjs.org/openai/7.51.0) |
| orval | 8.43.0 → **8.46.0 (published 2026-10-30T15:29:01.379Z; age 5d 13h)** (minor) | `lib/api-spec` | 8.43.0; exact pin requires manifest review; Node >=22.18.0; peers: typedoc ^0.28.19, prettier >=3.0.0 | [registry metadata](https://registry.npmjs.org/orval/8.46.0) |
| p-retry | 8.0.1 → **9.0.0 (published 2026-11-02T20:39:55.585Z; age 2d 8h)** (major) | `lib/integrations-openai-ai-server` | ^8.0.1; major evaluation; no automatic recommendation; Node >=22 | [registry metadata](https://registry.npmjs.org/p-retry/9.0.0) |
| react-hook-form | 7.90.0 → **7.91.0 (published 2026-10-23T21:37:28.462Z; age 12d 7h)** (minor) | `artifacts/mockup-sandbox`, `artifacts/run-calculator` | ^7.90.0; existing range accepts candidate; Node >=18.0.0; peers: react ^16.8.0 \|\| ^17 \|\| ^18 \|\| ^19, @types/react * | [registry metadata](https://registry.npmjs.org/react-hook-form/7.91.0) |
| react-resizable-panels | 4.14.5 → **4.14.8 (published 2026-10-20T22:54:21.707Z; age 15d 6h)** (patch) | `artifacts/mockup-sandbox`, `artifacts/run-calculator` | ^4.14.5; existing range accepts candidate; No Node engine declared; peers: react ^18.0.0 \|\| ^19.0.0, react-dom ^18.0.0 \|\| ^19.0.0 | [registry metadata](https://registry.npmjs.org/react-resizable-panels/4.14.8) |
| react-resizable-panels | 4.14.5 → **4.18.0 (published 2026-11-04T02:12:50.649Z; age 1d 3h) — newest 4.18.1 published 2026-11-05T00:43:04.047Z, age 0d 4h, blocked by 24h policy** (minor) | `artifacts/mockup-sandbox`, `artifacts/run-calculator` | ^4.14.5; existing range accepts candidate; No Node engine declared; peers: react ^18.0.0 \|\| ^19.0.0, react-dom ^18.0.0 \|\| ^19.0.0, @types/react ^18.2.6 \|\| ^19.0.0 | [registry metadata](https://registry.npmjs.org/react-resizable-panels/4.18.1) |
| tailwindcss | 4.3.3 → **4.3.4 (published 2026-11-02T21:30:42.446Z; age 2d 7h)** (patch) | `artifacts/mockup-sandbox`, `artifacts/run-calculator` | ^4.3.3; existing range accepts candidate; No Node engine declared | [registry metadata](https://registry.npmjs.org/tailwindcss/4.3.4) |
| thread-stream | 4.2.0 → **4.2.1 (published 2026-11-02T17:30:08.932Z; age 2d 11h)** (patch) | `artifacts/api-server` | 4.2.0; exact pin requires manifest review; Node >=20 | [registry metadata](https://registry.npmjs.org/thread-stream/4.2.1) |
| typedoc-plugin-markdown | 4.14.0 → **4.14.1 (published 2026-10-19T16:56:37.694Z; age 16d 12h)** (patch) | `lib/api-spec` | 4.14.0; exact pin requires manifest review; Node >= 18; peers: typedoc 0.28.x | [registry metadata](https://registry.npmjs.org/typedoc-plugin-markdown/4.14.1) |
| typescript | 6.0.3 → **7.0.2 (published 2026-07-08T15:55:18.431Z; age 119d 13h)** (major) | `.`, `lib/api-spec`, `lib/typescript-api-v6` | ~6.0.3; 6.0.3; major evaluation; no automatic recommendation; Node >=16.20.0 | [registry metadata](https://registry.npmjs.org/typescript/7.0.2) |
| vite | 8.3.4 → **8.3.5 (published 2026-10-21T06:38:54.907Z; age 14d 22h)** (patch) | `artifacts/mockup-sandbox`, `artifacts/run-calculator` | ^8.3.4; existing range accepts candidate; Node ^20.19.0 \|\| >=22.12.0; peers: @types/node ^20.19.0 \|\| >=22.12.0 | [registry metadata](https://registry.npmjs.org/vite/8.3.5) |
| vitest | 5.0.5 → **5.1.0 (published 2026-11-02T16:12:37.770Z; age 2d 13h)** (minor) | `artifacts/api-server`, `artifacts/run-calculator`, `lib/ai-evaluation`, `lib/anomaly`, `lib/api-zod`, `lib/cheese-import`, `lib/cheese-recipes`, `lib/cheese-reconcile`, `lib/corpus-harness`, `lib/day-summary`, `lib/distill-dataset`, `lib/downtime-trends`, `lib/formula-guard`, `lib/freezer-pull`, `lib/incident-cluster`, `lib/ingredient-catalog`, `lib/integrations-openai-ai-server`, `lib/inventory-math`, `lib/live-calc`, `lib/merge-suggest`, `lib/mix-reconcile`, `lib/mixes`, `lib/name-match`, `lib/named-recipes`, `lib/premix-import`, `lib/production-rules`, `lib/profile-cleanup`, `lib/recipe-guide-import`, `lib/schedule-move`, `lib/schedule-optimize`, `lib/scheduled-recipe-check`, `lib/setup-math-check`, `lib/shipping-import`, `lib/spec-export`, `lib/spec-import`, `lib/spec-reconcile`, `lib/sync-contract`, `scripts` | 5.0.5; ^5.0.5; exact pin requires manifest review; Node ^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0; peers: vite ^6.4.0 \|\| ^7.0.0 \|\| ^8.0.0, @types/node ^22.0.0 \|\| >=24.0.0 | [registry metadata](https://registry.npmjs.org/vitest/5.1.0) |

## Prioritized evaluation

### 1. In-range patch/minor candidates (evaluate first; no installation in this task)

- **Shared web catalog patches:** `@tailwindcss/vite` 4.3.3→4.3.4 and `tailwindcss` 4.3.3→4.3.4; update as one catalog pair across `artifacts/run-calculator` and `artifacts/mockup-sandbox`. Suggested checks: both artifact typechecks/builds and representative styling/preview checks.
- **Shared TanStack Query:** 5.104.5 patch candidate and 5.105.3 eligible minor candidate across `lib/api-client-react` and `artifacts/run-calculator`. 5.106.0 is newly published and blocked by age at this snapshot. Validate generated client typing, query/cache behavior, client tests, and both relevant builds.
- **Shared UI/dev tool updates:** `@vitejs/plugin-react` 6.2.1, `lucide-react` 1.67.0 (1.68.0 age-blocked), `react-hook-form` 7.91.0, `react-resizable-panels` 4.14.8 and eligible 4.18.0 (4.18.1 age-blocked), and Vite 8.3.5. `@vitejs/plugin-react` 6.2.1 declares Vite `^8`; React peers for panels remain compatible with React 19. Validate both artifact typechecks/builds, calculator tests, and browser/reduced-motion checks for any UI/interaction changes.
- **Provider SDKs:** `@google/genai` 2.32.0 is a minor update (Node `>=20`, compatible with Node 24); `openai` 7.50.0 is the latest eligible minor at this snapshot (7.51.0 is only 4.4 hours old and blocked). Candidate metadata says OpenAI needs Node `>=22`, accepts Zod 3/4 and Undici 5–8; check the SDK release notes, provider request/response and error handling, adapter tests, and API build. `p-retry` 9.0.0 is a separate major evaluation, not part of the in-range group.
- **Runtime/type and API-adjacent patches:** `@types/node` 26.6.6 is a declaration-only patch across nine importers; `vite` 8.3.5 affects both web artifacts. Update tests should remain on Node 24; do not conflate this type package with Node runtime promotion.
- **Exact-pinned patch/minor candidates needing a pin decision:** `thread-stream` 4.2.1 and `typedoc-plugin-markdown` 4.14.1 are exact-pinned in their manifests; `vitest` 5.1.0 requires coordinated review of exact direct pins across most test-bearing importers and the paired workspace `vitest` / `@vitest/mocker` overrides. `orval` 8.46.0 is exact-pinned and changes generated API tooling. These are reported as eligible releases, not as drop-in updates. For Vitest, validate the whole test matrix and align its companion package/override; for TypeDoc, run docs/codegen checks; for Orval, run `pnpm run check:api-generated` and review the generated diff.

### 2. Major-version evaluations (separate approval; do not auto-upgrade)

- `@hookform/resolvers` 5.9.2 has newer stable 6.0.2 (published 2026-10-28T07:01:31.489Z; age 190.4h) and 7.0.2 (published 2026-11-03T15:46:30.639Z; age 37.7h); the current `^5.9.1` declaration accepts neither. Both are age-eligible, and 7.0.2 is the newest major line. Release notes include breaking changes (including TypeBox package migration at 7.0.0). [6.0.2 registry metadata](https://registry.npmjs.org/%40hookform%2Fresolvers/6.0.2). Evaluate the resolver actually used by the app, Zod 4 integration, form validation and error messages before selecting a major.
- `chokidar` 6.0.0 is outside `^5.0.0` and requires Node `>=22.22` (compatible with the current Node 24 baseline). Review watcher API/config behavior and the mockup-sandbox dev workflow.
- `p-retry` 9.0.0 is outside `^8.0.1`, requires Node `>=22`, and changes abort behavior: once a signal is aborted, the promise rejects with the abort reason and no further callbacks run. Validate adapter retry/abort semantics in `lib/integrations-openai-ai-server`.
- TypeScript 6.0.3→7.0.2 is a major candidate but compiler qualification is owned by **task #3803**; the root `~6.0.3` and API-spec / TypeScript-v6 exact pins are outside this inventory's change scope. The root `typescript-native` comparison alias remains 7.0.2. No compiler decision is made here.

### 3. Deferred, blocked, or not currently available

- The newest versions of `@tanstack/react-query` 5.106.0, `lucide-react` 1.68.0, `openai` 7.51.0, and `react-resizable-panels` 4.18.1 were published within 24 hours of the snapshot and are **policy-blocked**. Use the eligible versions listed above or recheck after the age window; do not add package exclusions.
- Exact pins remain explicit gates, not evidence of incompatibility: `orval`, `thread-stream`, `typedoc-plugin-markdown`, the majority of direct Vitest declarations, plus the TypeScript/toolchain entries. Do not silently widen pins or overrides to consume candidates.
- No newer stable direct Drizzle ORM/Kit, `pg`, Playwright, Workbox, or Vite PWA plugin release was found in the registry snapshot. Their presence in this inventory is confirmed by the complete declaration matrix; this is not a claim that future releases are unavailable.
- No newer stable candidate was found for the other **88** registry identities at the snapshot timestamp. Recheck at implementation time, since package registries are mutable.

## Compatibility and coupling assessment

- **Catalogs:** candidates in shared catalog entries must be reviewed and resolved consistently across all importers; Tailwind's Vite integration and core CSS package should move together. React / React DOM are pinned at 19.3.1 and have no newer stable candidate in this snapshot.
- **0.x SemVer:** treat a changed minor component for any 0.x dependency as potentially breaking rather than routine. No newer stable candidate was found for the current 0.x direct declarations in this snapshot.
- **Exact pins:** `vitest` and its workspace override pair, `orval`, `thread-stream`, and `typedoc-plugin-markdown` require explicit pin review. A candidate outside an exact pin or declared major range is not installable without a manifest change.
- **Generated API:** Orval and TypeScript directly influence generated API artifacts; upgrade separately, regenerate only with the approved command, and inspect the complete generated diff.
- **DB libraries/drivers:** no newer stable direct candidate was found for `drizzle-orm`, `drizzle-kit`, `drizzle-zod`, `pg`, or `@types/pg`. Any future ORM/driver change needs focused DB tests and schema/codegen review; this inventory did not migrate or push schema.
- **Provider SDKs:** Google GenAI/OpenAI are production dependencies in the API/provider integration and their release changes can affect requests, structured output, retries, error types, or optional peers. Validate through provider adapter tests and the API test/build gates; do not infer compatibility from semver alone.
- **Test/build coupling:** the Vitest 5.1.0 candidate interacts with exact pins and the `@vitest/mocker` override; Vite and plugin candidates affect two web artifacts. Playwright has no new stable candidate, and no browser/toolchain version is changed here.
- **Release age:** stable releases less than 1,440 minutes old are explicitly blocked in the candidate table, even when semver-compatible.

## Security audit and transitive package findings

### Audit results

- **Production:** `pnpm run audit:prod:release` **PASS**, exit 0: “No known vulnerabilities found.” This is the configured production-only audit with high threshold, not a production-readiness verdict.
- **Full workspace:** `pnpm audit --json` returned exit 1 with **16 advisories** (4 low, 8 moderate, 4 high) across 868 reported dependency instances. The command did not report a registry failure. All listed findings are development/tooling paths in this lockfile; they remain relevant to local/CI supply-chain and test/build environments but were not reported by the production-only audit.

### Vulnerable or deprecated transitive dependencies

| Package / locked version | Finding | Dependency path and importer impact | Safe parent direction / status |
|---|---|---|---|
| `undici` 7.29.1 | 8 advisories (4 high, 4 moderate); patched at 7.30.1 | 41 audit paths: `vitest → jsdom → undici` across test importers, `artifacts/run-calculator → jsdom → undici`, and `lib/api-spec → orval → @scalar/* → undici`. Workspace override currently pins `undici` to 7.29.1. [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c), [GHSA-4w7w-5xrc-9h26](https://github.com/advisories/GHSA-4w7w-5xrc-9h26), [GHSA-2m5v-pch6-74hx](https://github.com/advisories/GHSA-2m5v-pch6-74hx), [GHSA-qrxm-fqhp-jwvm](https://github.com/advisories/GHSA-qrxm-fqhp-jwvm), [GHSA-4qv8-2p9j-2685](https://github.com/advisories/GHSA-4qv8-2p9j-2685), [GHSA-f72v-6w45-q472](https://github.com/advisories/GHSA-f72v-6w45-q472), [GHSA-9fm3-97px-rjf6](https://github.com/advisories/GHSA-9fm3-97px-rjf6), and [GHSA-55wc-3pg8-jfw6](https://github.com/advisories/GHSA-55wc-3pg8-jfw6). | First evaluate upstream Vitest/jsdom and Orval/Scalar parent updates. Because the existing global security override is below the audited fix, separately review that existing override against all consumers and the fixed release before applying any change; do not add a new broad override here. |
| `fast-uri` 3.1.8 | 4 advisories (2 moderate, 2 low); patched at 3.1.9 | 6 paths through `ajv`: `@hookform/resolvers`, Workbox (`vite-plugin-pwa`), and Orval/Scalar validator chains in run-calculator and api-spec. Existing workspace override pins 3.1.8. [GHSA-w74x-v6f9-j3xg](https://github.com/advisories/GHSA-w74x-v6f9-j3xg), [GHSA-wjr9-j795-jxcr](https://github.com/advisories/GHSA-wjr9-j795-jxcr), [GHSA-xhq7-xmqj-769h](https://github.com/advisories/GHSA-xhq7-xmqj-769h), [GHSA-333x-w4r6-6crp](https://github.com/advisories/GHSA-333x-w4r6-6crp). | Check whether current Ajv consumers accept 3.1.9, and evaluate `@hookform/resolvers`, Workbox/PWA, and Orval/Scalar parent updates. Since an existing override pins below the fixed release, review that exact security override separately; no arbitrary override was added. |
| `serialize-javascript` 7.1.2 | 1 low XSS advisory; patched at 7.1.3 | `artifacts/run-calculator → vite-plugin-pwa → workbox-build → @rollup/plugin-terser → serialize-javascript`. Existing scoped override pins 7.1.2. [GHSA-m5mm-p8h7-m29v](https://github.com/advisories/GHSA-m5mm-p8h7-m29v). | Evaluate updated Workbox/PWA and terser parent compatibility. Review the existing scoped override against 7.1.3 in a separate security fix; do not add a broad replacement. |
| `glob` 11.1.0 (deprecated) | 1 moderate advisory; patched at 14.0.2; npm deprecation notice says older versions are unsupported and contain known security vulnerabilities | `artifacts/run-calculator → vite-plugin-pwa → workbox-build → glob`. [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4); [registry deprecation metadata](https://registry.npmjs.org/glob/11.1.0). | Update/evaluate Workbox through the PWA plugin when upstream offers a compatible dependency path; test service-worker generation, offline startup, update/cache behavior, and fallback. Do not force a major transitive `glob` override. |
| `minimatch` 10.2.6 | 1 moderate denial-of-service advisory; patched at >=11.0.1 | 6 audited paths: run-calculator Workbox `glob → minimatch`, and api-spec TypeDoc/Orval/typedoc-plugin-markdown TypeDoc trees. A second `minimatch@5.1.9` is also installed, but the audited finding is 10.2.6. [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249). | Evaluate `glob`/Workbox and TypeDoc parents for upstream ranges that admit the fixed major. The current nested brace-expansion overrides are not a minimatch fix; do not override blindly across consumers. |
| `deepmerge` 4.3.1 | 1 low prototype-poisoning advisory; the npm audit record listed **no patched version** | `artifacts/run-calculator → vite-plugin-pwa → workbox-build → @rollup/plugin-node-resolve → deepmerge`. [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4). | Track the upstream `@rollup/plugin-node-resolve` / Workbox parent chain for a release with a verified fix. No fix version is present in the audit record; do not fabricate one or add an arbitrary override. |
| `node-domexception` 1.0.0 (deprecated) | Deprecated transitive package; no advisory reported by this audit | `@google/genai → google-auth-library → gaxios → node-fetch → fetch-blob → node-domexception` in API and provider integration importers. | Follow Google auth / gaxios / node-fetch / fetch-blob parent updates and verify that the deprecated fallback is removed. [Registry deprecation metadata](https://registry.npmjs.org/node-domexception/1.0.0). This is a deprecation notice, not a security advisory; no override is appropriate. |

The production audit threshold and full-workspace result are intentionally reported separately. Existing security overrides and platform-specific optional-package protections were left intact; audit findings are not addressed by this inventory.

## Release-note and compatibility references

- [Google GenAI 2.32.0](https://github.com/googleapis/js-genai/releases/tag/v2.32.0) — official SDK release.
- [OpenAI Node 7.50.0](https://github.com/openai/openai-node/releases/tag/v7.50.0) and [release list](https://github.com/openai/openai-node/releases) — the 7.51.0 npm release is within the policy window at snapshot time.
- [Orval 8.46.0](https://github.com/orval-labs/orval/releases/tag/v8.46.0) — generated API tooling; candidate remains exact-pinned.
- [Vite 8.3.5 changelog](https://github.com/vitejs/vite/blob/v8.3.5/packages/vite/CHANGELOG.md) and [Vitest 5.1.0 release](https://github.com/vitest-dev/vitest/releases/tag/v5.1.0).
- [React Hook Form resolvers 7.0.2](https://github.com/react-hook-form/resolvers/releases/tag/v7.0.2), [Chokidar 6.0.0](https://github.com/paulmillr/chokidar/releases/tag/6.0.0), and [p-retry 9.0.0](https://github.com/sindresorhus/p-retry/releases/tag/v9.0.0) — major candidates for evaluation only.
- Every candidate row links directly to its npm registry version metadata; it contains the version's publish timestamp and manifest metadata used for age, engines, and peers.

## Verification and change boundary

| Check | Result | Evidence |
|---|---|---|
| Manifest and importer reconciliation | **PASS** | 52 manifests/importers including root; 226 non-peer external declarations + 2 peer constraints; no missing importers or non-peer lock resolutions; 107 registry identities. |
| Registry metadata coverage | **PASS** | 107 npm package identities queried; no registry errors. Full timestamp metadata fetched for all 19 identities with `pnpm outdated` signal; stable patch/minor/major candidates and their ages were independently evaluated. |
| `pnpm outdated -r --format json` | **PASS (signal; exit 1 expected)** | 21 result entries. `wanted=current` across returned items; freshest registry findings and its known lag are described above. |
| Production audit | **PASS** | `pnpm run audit:prod:release`; exit 0, no known production vulnerabilities at configured threshold. |
| Full-workspace audit | **FINDINGS** | `pnpm audit --json`; exit 1 with 16 advisory records; no registry error. Security findings, paths, fixes, and parent directions above. |
| Change-scope boundary | **PASS** | Only this dated report is intended to change; no package manifest, lockfile, override, toolchain pin, application code, installation, or schema was touched. |
| Whitespace check | **PASS** | `git diff --no-index --check /dev/null docs/dependency-update-inventory-2026-11-05.md`; no whitespace errors (exit 1 indicates the untracked file differs from `/dev/null`). |

## Source and configuration inventory

- Dependency manifests: root `package.json`; all `artifacts/*/package.json`, `lib/*/package.json`, and `scripts/package.json` included by the workspace. Generated/offline trace manifests and tool caches were excluded.
- Lockfile and policy: `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`; `pnpm@12.8.1`, `minimumReleaseAge: 1440`, existing 86 overrides and exclusions.
- Automation/toolchain context: `.github/dependabot.yml` (weekly npm and GitHub Actions updates), `.github/workflows/ci.yml` (frozen install and production audit), root package manager and engine declarations, and `.nvmrc` pinned to **Node 24.21.0**.
- Previous inventory baseline: [2026-10-14 dependency inventory](dependency-update-inventory-2026-10-14.md). This report is a fresh snapshot and does not assume that report's candidate list or manifest counts remain current.
