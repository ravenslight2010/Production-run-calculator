# Workspace dependency and toolchain inventory — 2026-10-02

**Snapshot:** `d12725c8` (2026-10-02), before this report was added. Registry
metadata was captured at `2026-10-02T22:00:21Z`. This is an inventory, not an
installation, compatibility approval, security certification, or release
decision. No dependency, lockfile, application, CI, or generated file was
changed.

## Method and current baseline

- Compared direct dependency declarations in all **50 workspace members** and
  the root against the normal dependency document in `pnpm-lock.yaml` (**51
  importers including the root**). A separate leading lockfile document records
  the pinned pnpm executable. The recursive query returned 18 direct package
  names; lockfile importer rows were used to confirm direct scopes and locked
  resolutions, since the query's `dependentPackages` list does not always name
  every workspace member that directly declares a package.
- Ran `pnpm outdated -r --format json` using
  `scripts/src/run-release-node.sh`: Node **24.20.0**, pnpm **12.6.0**. The
  command exited **1**, as expected when packages are outdated, and returned
  18 package names. There were no registry errors. Its `wanted` field equaled
  `current` in all 18 rows; this does not mean no candidate exists. The
  `latest` values below were independently checked against the declared
  ranges, lockfile, and registry publish times.
- Commands ran with temporary writable npm, Corepack, and XDG cache/config
  locations. Stderr contained npm notices about the two `.npmrc` keys and a
  newer npm CLI; these were not registry failures. The repository `.npmrc` was
  unchanged.
- The workspace still requires `minimumReleaseAge: 1440` minutes. The only
  exclusions are `@replit/*` and `stripe-replit-sync`. Each candidate marked
  eligible below had been published at least 24 hours before the registry
  snapshot. Registry tags that were newer than that are called out separately
  and are **not** upgrade candidates yet.
- The root pins `pnpm@12.6.0` in `package.json` and the lockfile. `.nvmrc` and
  release-critical CI jobs pin Node **24.20.0**; root engines require Node
  `>=24` and pnpm `>=12`. `pnpm-workspace.yaml` contains 93 overrides, including
  security pins, Vite alignment, the Vitest pair, and platform-specific
  optional-binary exclusions. `.npmrc` continues to set
  `auto-install-peers=false` and `strict-peer-dependencies=false`.
- Registry toolchain comparison: npm's `pnpm` latest tag was **12.8.1**
  (published 2026-09-28, eligible under the age policy; Node engine `>=18`).
  Node's current 24.x LTS release was **24.21.0** (2026-09-07); the newest
  Node major was **26.10.0** (2026-09-21). These are observations, not an
  approval to change pins. Node 26 is a major runtime move and is deferred.

`Prod` below means a direct declaration under `dependencies` in at least one
workspace member; `Dev` means a direct `devDependencies` declaration. A package
may appear in both. This classification is not a claim about whether a package
is ultimately included in a browser bundle. Catalog declarations are expanded
to their current ranges.

## Direct dependency candidates

Each row is **declared → locked → highest age-eligible registry release at the
snapshot**. Publish dates are UTC. All listed releases satisfy the one-day
minimum-age rule; registry availability is not compatibility approval.

| Package | Scope and affected workspace areas | Declared → locked → eligible release | Risk and next action |
| --- | --- | --- | --- |
| `pg` | Prod + Dev; `lib/db`, `scripts`, API server, run calculator | `^8.23.0` → `8.23.0` → **8.23.1** (patch; 2026-09-30) | Small database-client update, but it is in the DB runtime path. Recheck registry age when implementing; run DB/API typechecks and focused DB transaction/integration tests. |
| `openai` | Prod; `lib/integrations-openai-ai-server` | `^7.25.0` → `7.25.0` → **7.26.0** (minor; 2026-10-01 21:22 UTC) | Provider SDK behavior can affect request and retry handling. Review the provider change and run the integration adapter tests plus API build/typecheck. The `7.27.0` tag was too new at capture time. |
| `@tanstack/react-query` | Prod + Dev; `lib/api-client-react`, run calculator | catalog `^5.102.8` → `5.102.8` → **5.104.0** (minor; 2026-09-26) | Query invalidation and refresh behavior; run client typecheck and focused data-refresh/sync tests. |
| `vite` | Dev; run calculator and mockup sandbox | `^8.3.0` → `8.3.0` → **8.3.2** (patch; 2026-10-01) | Build, proxy, and PWA coupling. Run both frontend builds, workbook-boundary checks, and a development proxy smoke. Nested Vite remains aligned by the catalog override. |
| `@types/node` | Dev; API, both frontends, DB, AI evaluation, corpus, distill dataset, integration library, scripts | catalog `^26.5.1` → `26.5.1` → **26.6.3** (minor; 2026-09-25) | Ambient type changes can expose diagnostics across the workspace. Run the full typecheck and API build. `26.6.4` was not yet 24 hours old. |
| `tsx` | Dev; scripts and corpus harness | catalog `^4.23.13` → `4.23.13` → **4.23.15** (patch; 2026-09-20) | Script-loader risk is limited but shared. Run the script suite and clean-start/CLI checks. |
| `vitest` | Dev; API, calculator, scripts, and shared-library test workspaces | Usually exact `5.0.0`; `scripts` and `ai-evaluation` also declare `^4.1.9` under the override → `5.0.0` → **5.0.3** (patch; 2026-09-30) | **Defer as a coordinated change.** Most declarations are exact, and `vitest` plus `@vitest/mocker` are both overridden to `5.0.0`. Align declarations and both overrides together, then run API, calculator, scripts, and representative library suites. |
| `@testing-library/dom` | Dev; run calculator | `^10.4.1` → `10.4.1` → **10.4.2** (patch; 2026-09-13) | Test-only patch; include with a bounded calculator test-tooling refresh and run the calculator suite. |
| `jsdom` | Dev; run calculator | `^30.0.1` → `30.0.1` → **30.1.1** (minor; 2026-09-22) | DOM behavior changes affect tests. Its Node engine range accepts the pinned Node 24.20.0. Run the calculator suite. |
| `react-day-picker` | Dev; both frontends | `^10.0.1` → `10.0.1` → **10.0.2** (patch; 2026-09-30) | Calendar behavior; run the affected date-picker tests and both frontend builds. |
| `react-hook-form` | Dev; both frontends | `^7.88.0` → `7.88.0` → **7.89.0** (minor; 2026-09-26) | Form state and validation behavior; run form-focused tests and both frontend typechecks/builds. |
| `react-resizable-panels` | Dev; both frontends | `^4.12.4` → `4.12.4` → **4.14.1** (minor; 2026-09-27) | Layout interactions need a focused resize/browser smoke in addition to both frontend builds. `4.14.2` was too new at capture time. |
| `framer-motion` | Dev; both frontends | catalog `^13.2.0` → `13.2.0` → **13.5.0** (minor; 2026-10-01) | Verify actual usage and check affected builds/animations. The `14.0.0` tag is both a major change outside the current range and less than 24 hours old. |
| `lucide-react` | Dev; both frontends | catalog `^1.45.0` → `1.45.0` → **1.49.0** (minor; 2026-09-29) | Check icon exports and affected views, then build both frontends. `1.50.0` was too new at capture time. |
| `tailwind-merge` | Dev; both frontends | catalog `^3.6.0` → `3.6.0` → **3.7.0** (minor; 2026-09-12) | CSS conflict resolution can change. Run frontend builds and checks around affected utility-class combinations. |
| `wouter` | Dev; run calculator | `^3.11.0` → `3.11.0` → **3.13.0** (minor; 2026-09-30) | Route/navigation behavior; run route-focused tests and the calculator browser smoke. |
| `prettier` | Dev; workspace root | `^3.9.6` → `3.9.6` → **3.9.9** (patch; 2026-09-23) | Low runtime risk; use a no-write formatting diff and avoid broad unrelated formatting churn. |
| `typescript` | Dev; root and API spec | root `~6.0.3`, API spec exact `6.0.3` → `6.0.3` → **7.0.2** (major; 2026-07-08) | **Intentional deferral, not a routine candidate.** The root's `typescript-native` alias already supplies 7.0.2 for comparison. Keep promotion on its separate TypeScript 7 evidence/release-gate track; do not change the active compiler here. |

The direct package areas above were cross-checked against importer declarations.
In particular, `pnpm outdated` named only the API server and run calculator for
`pg`, and only the run calculator for `@tanstack/react-query`; the lockfile also
has direct declarations in `lib/db` and `scripts` for `pg`, and
`lib/api-client-react` for React Query. Use importer rows, not only the
`dependentPackages` array, to determine the full workspace scope.

### Newer registry tags that are not eligible yet

At `2026-10-02T22:00:21Z`, these raw npm `latest` tags had been published less
than 1,440 minutes earlier. They are **not** substituted for the eligible
versions in the table:

| Package | Raw `latest` tag | Published (UTC) | Approximate age at snapshot |
| --- | --- | --- | --- |
| `@tanstack/react-query` | 5.104.1 | 2026-10-02 10:04 | 11h 55m |
| `@types/node` | 26.6.4 | 2026-10-01 22:39 | 23h 21m |
| `framer-motion` | 14.0.0 | 2026-10-02 13:16 | 8h 44m; also a major release |
| `lucide-react` | 1.50.0 | 2026-10-02 11:25 | 10h 35m |
| `openai` | 7.27.0 | 2026-10-01 23:10 | 22h 50m |
| `react-resizable-panels` | 4.14.2 | 2026-10-02 19:19 | 2h 40m |

Re-query these versions when implementing; do not bypass the age policy.

## Security audit and override findings

Commands used the pinned Node/pnpm runner and did not use
`--ignore-registry-errors`.

| Command | Outcome |
| --- | --- |
| `pnpm run audit:prod:release` (`pnpm audit --prod --audit-level high`) | Exit **0**; “No known vulnerabilities found.” |
| `pnpm audit --prod --json` | Exit **0**; 0 info, low, moderate, high, or critical advisories; 185 production-graph dependencies reported. |
| `pnpm audit --audit-level high` | Exit **0**; 3 findings in the full graph (1 low, 2 moderate), no high or critical finding. |
| `pnpm audit --json` | Exit **1** at the default threshold; confirms 1 low and 2 moderate advisories, with 885 dependencies reported in the full graph. |

All three full-workspace findings are marked development-only by the audit and
are outside the production graph:

| Package currently resolved | Finding | Patched release and age | Current constraint / recommendation |
| --- | --- | --- | --- |
| `fast-uri` 3.1.7 | Moderate, GHSA-hrr3-gc8f-f4qj; run calculator and mockup through `@hookform/resolvers` → `ajv`, run calculator's PWA build chain, and API spec through Orval/Scalar validation | `>=3.1.8`; 3.1.8 published 2026-09-15 | The workspace currently overrides `fast-uri` to exactly 3.1.7. Move the pin to a patched compatible release after checking its dependents; retain the override. |
| `brace-expansion` 2.1.6 | Moderate, GHSA-q2hr-2g5m-vwhr; run calculator's `vite-plugin-pwa` → `workbox-build` chain | `>=2.1.7`; 2.1.7 published 2026-09-14 | The `minimatch@5>brace-expansion` override pins 2.1.6. Update this affected major-line override; do not remove the separate v5 override. |
| `serialize-javascript` 7.1.1 | Low, GHSA-gfhx-hw2g-v5hg; run calculator's `vite-plugin-pwa` → `workbox-build` → `@rollup/plugin-terser` chain | `>=7.1.2`; 7.1.2 published 2026-09-23 | No direct workspace override is present. Review the parent dependency update or add a narrowly scoped pin if required; validate the build chain. |

The patched versions above satisfy the 24-hour release-age policy at this
snapshot. The high-threshold audit's exit 0 only means no finding met that
threshold; it does **not** mean the full workspace is vulnerability-free. Do
not remove overrides or treat this inventory as a security certification.

## Ordered implementation slices

1. **Repair the three development-graph advisories first.** Update the
   `fast-uri` and `brace-expansion` security pins to patched compatible
   releases, and resolve `serialize-javascript` through its parent or a narrow
   override. Preserve the existing override protections. Re-run both audits,
   a frozen install, and focused run-calculator/API-spec build checks.
2. **Review the eligible runtime updates.** Evaluate `pg` 8.23.1 and OpenAI
   7.26.0 in a separate API/DB slice. Recheck the one-day window at edit time;
   run DB/API typechecks, focused DB transaction tests, provider adapter tests,
   and the API build.
3. **Handle toolchain pins in a separately justified proposal.** If desired,
   evaluate pnpm 12.8.1 and Node 24.21.0 together against the release runner,
   package-manager metadata, exact CI Node pins, and frozen-install/release
   evidence. Keep Node 26 and TypeScript 7 outside this slice.
4. The remaining eligible frontend/test/formatting rows are non-security
   maintenance. Prefer small batches: Vite/test tools, date/form/layout
   components, and visual utilities should be validated in their owning
   workspaces rather than swept into a lockfile-only refresh.

The October 2 Drizzle pair (`drizzle-orm` 0.45.3 / `drizzle-kit` 0.31.11) and
generated API tooling (`orval` 8.39.0 / Zod 4.6.5) are already present in the
current manifests and lockfile and did not appear in this recursive outdated
result. Their completed evaluations in
[`dependency-update-inventory-2026-09-25.md`](dependency-update-inventory-2026-09-25.md)
are not repeated as pending work here.