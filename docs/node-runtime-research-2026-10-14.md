# Node.js runtime status and compatibility follow-up

| Research date | 2026-10-14 |
|---|---|
| Repository revision reviewed | `41c44267bc8ea4d36e257a38056bda2eb1d7bfac` |
| Repository lockfile SHA-256 | `3726d5f41c220f24229139f6abe03329e19fa6a182f5456847cc8b442a5927b2` |

This assessment covers release lifecycle, repository runtime contracts, and prior advisory evidence. This task changed only this report; no runtime, dependency, CI, deployment-setting, or authoritative release-evidence files were modified. Pre-existing unrelated working-tree changes were left untouched.

## Decision

**Keep Node 24 as the only supported and authoritative project runtime. Do not promote Node 26.**

The release lifecycle has moved since the October 6 assessment, but not enough to change that recommendation:

- Node `26.12.0` is the latest release and remains **Current**, not LTS, on October 14. The official schedule plans its LTS transition for October 28; verify that transition has actually occurred before treating Node 26 as an LTS candidate.
- Node `24.22.0` is the latest LTS release. Node 24 remains in its Active LTS phase through the scheduled October 20 move to Maintenance LTS, with end of life scheduled for April 30, 2028.
- The Node project has announced HIGH-severity security fixes for the 26.x, 24.x, and 22.x lines on or shortly after October 21. Those releases had not yet shipped on the research date.
- The repository still pins Node `24.21.0`, and the October 6 advisory tested only `24.21.0` against `26.10.0`. Neither the new 24.22.0 patch nor Node 26.12.0 has this repository's comparison evidence.

The next bounded action is to **retain Node 24, then refresh advisory evidence after the announced October 21 security releases and after verifying the planned October 28 Node 26 LTS transition**. That comparison belongs in a separately approved qualification task. It must use then-current, mature exact patches and preserve the Node 24 baseline. It must not promote Node 26 unless the independent qualification gates below pass.

This is a research recommendation, not a production-readiness or deployment decision.

## Official lifecycle as of October 14, 2026

The Node.js releases page identifies the latest patch on each line and its broad status. The official schedule supplies the phase-transition and end-of-life dates. “Active LTS” versus “Maintenance LTS” below is determined from those schedule dates and the official lifecycle description; the releases table itself labels both simply “LTS.”

| Line | Latest release shown on research date | Status on 2026-10-14 | Lifecycle dates from official schedule |
|---|---|---|---|
| 26 | `26.12.0`, released October 14 | Current; not yet LTS | Started May 5, 2026; LTS planned October 28, 2026; Maintenance planned October 20, 2027; EOL April 30, 2029 |
| 24 | `24.22.0`, released October 14 | Active LTS; Maintenance planned October 20, 2026 | LTS began October 28, 2025; EOL April 30, 2028 |
| 22 | `22.23.3`, released September 23 | Maintenance LTS | Maintenance began October 21, 2025; EOL April 30, 2027 |
| 20 | `20.20.2`, last updated March 24 | EOL | EOL April 30, 2026 |

The schedule dates are planned lifecycle milestones, not guarantees that a transition happened exactly on that date. The official Node.js releases page says production applications should use Active LTS or Maintenance LTS, which excludes Node 26 while it is Current.

### Security notice

On October 14, the Node.js project announced security releases **on or shortly after Wednesday, October 21, 2026** for 26.x, 24.x, and 22.x. It identifies the highest severity being fixed on each of those lines as **HIGH**. The notice does not yet publish the affected CVEs or complete release versions. It also cautions that EOL lines are affected when a security release occurs and recommends using an up-to-date supported version.

The upcoming notice strengthens the case for promptly refreshing the Node 24 patch baseline through normal review; it does not justify promoting a Current major release. This research does not change the existing `24.21.0` pin or claim that any unpublished fix is already available.

## Repository and tooling evidence

| Evidence | Current repository state | What it establishes—and what it does not |
|---|---|---|
| Default and local runtime | `.nvmrc` is `24.21.0`; this research shell returned `v24.13.0` | The selector and interactive workspace runtime differ. The shell result is workspace-only and says nothing about the deployed process. |
| Workspace engine declaration | Root `package.json` declares Node `>=24` and pnpm `>=12`; package manager is pinned to pnpm `12.8.1` | The broad engine range admits Node 26 but is not an application compatibility promise or qualification. |
| Routine and release CI | `.github/workflows/ci.yml` and `.github/workflows/release-check.yml` explicitly use Node `24.21.0` | Required CI and release checks remain tied to Node 24. No required lane currently qualifies Node 26. |
| Container | `Dockerfile` pins `node:24.21.0-slim` by digest and checks that the image Node version matches `.nvmrc` | The built runtime image remains Node 24. The image is not evidence that Replit supports Node 26. |
| Replit workspace and deploy configuration | `.replit` selects `nodejs-24`; its Autoscale deployment has a build command and a Node-based run command | This is a Node 24 workspace module selection and project deployment configuration, not proof of the exact deployed Node patch or of Node 26 deployment support. |
| Replit documentation | Current Replit docs describe modules as environment support configured in `.replit`, and describe deployment build/run configuration separately | The consulted official docs do not state that a Node 26 module is available or guarantee Node 26 for an Autoscale deployment. Platform support remains **unknown** from the accessible evidence. |
| Current locked tooling | `pnpm-lock.yaml` contains Vite `8.3.2`, Vitest `5.0.3`, esbuild `0.28.2`, Rollup `4.63.1`, Rolldown `1.2.12`, Tailwind Oxide `4.3.3`, Linux x64 optional native packages, Lightning CSS `1.32.0`/`1.33.0`, and separate Undici `7.29.1` | These versions and platform-specific packages warrant real install/build/test coverage. Lockfile presence alone does not show correct binary selection or runtime behavior. |
| Current package engine metadata | Vite `8.3.2`: `^20.19.0 \|\| >=22.12.0`; Vitest `5.0.3`: `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0`; esbuild `0.28.2`: `>=18`; Rolldown `1.2.12`: `^20.19.0 \|\| >=22.12.0` | These published `engines` declarations allow Node 26 for these tools. They do not qualify this workspace, its complete dependency graph, native binaries, deployment platform, or production workload. |
| Runtime behavior change | Node 26.12.0 release notes include synchronous loading of most ES modules through `require()` | This is a runtime behavior change worth exercising in a current candidate run; the release note alone does not establish an app regression. |
| Existing candidate workflow | `.github/workflows/node-compatibility-advisory.yml` and `scripts/src/node-compatibility-advisory.mjs` are still pinned to Node `24.21.0` and `26.10.0` | Re-running the workflow as checked in would not compare either latest patch reported here. This task intentionally did not edit the workflow. |

The current lockfile is not the lockfile measured in the October 6 comparison: the retained JSON records SHA-256 `251d67bf080b4e0c8015913bc3f66e8229af0e8763325cfa723c93629e9e3f13`, while the repository lockfile reviewed here hashes to `3726d5f41c220f24229139f6abe03329e19fa6a182f5456847cc8b442a5927b2`. The older result must not be represented as execution evidence for the current lockfile or tool versions.

The Node 26.0 release introduced Undici 8.0 in the Node runtime. The current repository lockfile separately contains the `undici` npm package at `7.29.1`. The built-in runtime module and that package are distinct; neither their version numbers nor the tool engine ranges establish fetch behavior compatibility for this application.

## What the October 6 comparison proves

The retained comparison is advisory-only evidence from GitHub Actions run `37506619630`, attempt 1, on source revision `6a18a7d85e7150ac0e56500bc47696724f1b3a02`. It ran Node `24.21.0` and `26.10.0` sequentially on the same `ubuntu-latest` Linux x64 runner, in clean worktrees with isolated pnpm stores and disposable PostgreSQL databases.

| Check | Node 24.21.0 | Node 26.10.0 | Evidence boundary |
|---|---|---|---|
| Frozen install | PASS | PASS | Same-runner, one-run install evidence |
| Root typecheck | PASS | PASS | Same-runner, one-run typecheck evidence |
| Run-calculator budget test (`run-calculator-budget`) | **FAIL**, `EXIT_CODE_1` | **FAIL**, `EXIT_CODE_1` | Same named check failed on both; cause was not retained |
| Disposable database creation and schema application | PASS | PASS | Selected database setup only |
| API integration shard 1 | PASS | PASS | One selected integration shard only |
| Production build (`production-build`) | **FAIL**, `EXIT_CODE_1` | **FAIL**, `EXIT_CODE_1` | Same named check failed on both; cause was not retained |

The command output for both failed checks was deleted by the workflow. The results establish neither a Node-26-only regression nor a clean baseline: both cross-runtime failures remain unexplained. The repository does not identify a named person accountable for these failure causes. The accountable role is the Node advisory workflow maintainer; the next comparison should preserve sanitized, bounded failure diagnostics so that the cause can be established without retaining raw logs or payloads. Do not create a separate repair task from this report.

The comparison did **not** execute Node `26.12.0`, the current lockfile, a full required release suite, Replit deployment, or the production runtime. Its timing and memory deltas are a single-run observation, not statistically reliable performance claims. It cannot qualify Node 26.

## Qualification boundary and rollback

Before any separate Node 26 promotion proposal:

1. Confirm from current official Node sources that Node 26 has actually entered LTS, and select then-current exact patches for both the supported Node 24 baseline and Node 26. Require the candidate patches to be mature under the existing 24-hour candidate-age gate.
2. Use a refreshed advisory comparison on the same source revision and lockfile, with clean installs and bounded sanitized diagnostics. Resolve or explain the two shared `EXIT_CODE_1` failures before interpreting an all-green candidate result.
3. Repeat the hosted candidate comparison on at least two clean executions; pass all checks and the full required release suite without weakening the Node 24 baseline.
4. Obtain authoritative evidence that the Replit deployment build and runtime support the selected Node version, or record that support as unresolved. A Replit workspace module, package engine range, or GitHub-hosted run is not deployment evidence.
5. Only in a separately approved runtime-promotion change, align `.nvmrc`, CI and release pins, the Docker base image/digest, documentation, and evidence contracts. Keep a known-good Node 24 image and baseline available until the candidate is approved; if candidate build, startup, or health checks fail, revert the candidate change to the retained Node 24 image rather than changing data or schema.

## Source record

Official sources were checked on **2026-10-14**. The Node release schedule and releases table are live documents; the values above are the values observed on that date.

- [Node.js Releases](https://nodejs.org/en/about/previous-releases) — release-line status, latest versions, and production LTS guidance.
- [Node.js Release schedule (`schedule.json`)](https://github.com/nodejs/Release/blob/main/schedule.json) — lifecycle transition and EOL dates.
- [Node.js 26.12.0 release](https://nodejs.org/en/blog/release/v26.12.0) — latest Current release on the research date.
- [Node.js 24.22.0 release](https://nodejs.org/en/blog/release/v24.22.0) — latest LTS release on the research date.
- [Node.js 22.23.3 release](https://nodejs.org/en/blog/release/v22.23.3) — latest 22.x release shown on the research date.
- [October 21, 2026 security releases notice](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) — announced HIGH-severity fixes for 26.x, 24.x, and 22.x.
- [Node.js 26.0.0 release](https://nodejs.org/en/blog/release/v26.0.0) — Node 26 initial runtime changes, including bundled Undici 8.0.
- [Vite 8.3.2 registry metadata](https://registry.npmjs.org/vite/8.3.2), [Vitest 5.0.3 metadata](https://registry.npmjs.org/vitest/5.0.3), [esbuild 0.28.2 metadata](https://registry.npmjs.org/esbuild/0.28.2), and [Rolldown 1.2.12 metadata](https://registry.npmjs.org/rolldown/1.2.12) — package-declared engine ranges.
- [Replit project configuration documentation](https://docs.replit.com/features/project-setup/configuration), [dependency management](https://docs.replit.com/features/project-setup/dependency-management), and [deployment types](https://docs.replit.com/features/publishing/deployment-types) — module and deployment configuration concepts; these pages did not confirm Node 26 deployment support.
- Repository evidence: `.nvmrc`, `package.json`, `Dockerfile`, `.replit`, `.github/workflows/ci.yml`, `.github/workflows/release-check.yml`, `.github/workflows/node-compatibility-advisory.yml`, `scripts/src/node-compatibility-advisory.mjs`, `pnpm-lock.yaml`, `README.md`, `replit.md`, `docs/node-26-compatibility-evaluation-2026-10-06.md`, and `docs/node-26-compatibility-comparison-2026-10-06.json`.
