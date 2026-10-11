# Node 26 compatibility assessment

## Decision

Keep Node 24 as the only supported/default runtime. Node 26 is a **Current** release
on the assessment date, not yet an LTS release. The exact advisory candidate is
Node `26.10.0`, released on September 22, 2026. It is over the repository's
24-hour minimum release-age window. The Node release schedule lists October 28,
2026 as its planned LTS date.

This is a candidate assessment, not an approval to promote. The single-runner
comparison is a separate GitHub Actions workflow; it does not run through
`run-release-node.sh`, alter normal CI requirements, or write to the authoritative
release-evidence directories. Run it with **Run workflow** or let its path-filtered
pull-request trigger run. Each completed run uploads `comparison.json` and
`comparison.md` as a 14-day artifact. The completed comparison is recorded below
and in the linked advisory JSON sidecar. Its overall result is
**ADVISORY_FAILURE**: two checks failed on both runtimes, so Node 26 is not
qualified for promotion.

## Runtime and dependency inventory

| Constraint | Current contract | Node 26 implication |
|---|---|---|
| Local/default version | `.nvmrc` remains `24.21.0` | No default change in this assessment |
| Workspace metadata | root `engines.node` is `>=24`; `packageManager` is `pnpm@12.8.1` | The engine range admits Node 26, but is not runtime qualification |
| Routine CI | `.github/workflows/ci.yml` uses Node `24.21.0` | Required CI remains on the approved baseline |
| Release CI | `.github/workflows/release-check.yml` pins both release jobs to Node `24.21.0` | The candidate lane is not a release gate |
| Container | `Dockerfile` pins `node:24.21.0-slim` by digest | Production image remains unchanged |
| Release preflight | `run-release-node.sh` and `check-routine-node-version.mjs` bind checks to retained Node 24 evidence | Do not run the release runner under Node 26 |
| Release-age policy | `pnpm-workspace.yaml` sets `minimumReleaseAge: 1440` minutes | Node 26.10.0 is well past 24 hours; this package policy does not change |
| Type declarations | The lockfile already includes `@types/node` 26.5.1 | Type declarations do not prove runtime compatibility |
| Core tooling | Locked Vite 8.3.0 accepts Node `^20.19.0 || >=22.12.0`; Vitest 5.0.0 explicitly accepts `>=26.0.0` | Declared engine ranges admit Node 26; installed native tooling and actual execution still need comparison |
| Runtime APIs | Node 26.10.0 ships V8 14.6; Node 26.0 release notes list Undici 8.0, while the lockfile pins the separate Undici package at 7.29.1 | Check build/test execution and fetch-related behavior; an engine-range match alone is insufficient |
| Platform packages | The lockfile contains optional Linux/native build tooling, including esbuild and platform-specific build packages | The advisory run uses fresh installs on the same `ubuntu-latest` x64 runner to exercise binary selection and builds |

The locked Linux x64 binary packages include `@esbuild/linux-x64` 0.28.2,
`@rollup/rollup-linux-x64-gnu` 4.63.1, `@tailwindcss/oxide-linux-x64-gnu`
4.3.3, and `lightningcss-linux-x64-gnu` 1.32.0/1.33.0. These packages have
platform-specific selection/build behavior that broad Node engine ranges do not
qualify.

Node `26.10.0` release notes:
<https://nodejs.org/en/blog/release/v26.10.0>

Node 26.0 release notes, including the Undici 8.0 update:
<https://nodejs.org/en/blog/release/v26.0.0>

Official release schedule:
<https://raw.githubusercontent.com/nodejs/Release/HEAD/schedule.json>

## Comparison design and evidence

`.github/workflows/node-compatibility-advisory.yml` runs Node `24.21.0` and
`26.10.0` sequentially on one `ubuntu-latest` hosted runner. It verifies that
both binaries and pnpm match their exact pins, creates two clean detached
worktrees of the same GitHub source revision, uses a separate cold pnpm store
for each, and gives the API integration test separate disposable PostgreSQL
databases. Every measured command has a timeout. The overall job is capped at
240 minutes.

The checks are frozen install, root typecheck, the run-calculator budgeted unit
suite, database schema application, API integration shard 1, and the repository
production build. A failed or timed-out candidate check is recorded as an
advisory result; it does not change the existing Node 24 CI or release checks.
The comparison script stores no command output, database records, or test
payloads in the report. Temporary command output is deleted after measurement.

Each report records:

- capture time, exact source revision, and `pnpm-lock.yaml` SHA-256;
- hosted runner label, OS, architecture, CPU count, and memory;
- exact Node and pnpm versions;
- command outcome, exit status, elapsed milliseconds, and GNU `time` maximum
  resident set size when available;
- per-check Node 26 minus Node 24 elapsed-time and memory deltas.

The memory number is GNU `time`'s reported maximum resident set size for the
top-level measured command. It is useful for a like-for-like comparison but is
not a cgroup-wide aggregate memory measurement. The artifact is advisory test
evidence, not a signed release artifact or production observation.

### Hosted comparison results

The workflow completed on October 6, 2026. The first attempt stopped before
measurement while preparing a clean worktree; it produced no report. The
comparison worktree now skips downloading unrelated Git LFS archives, which are
not inputs to these checks. The measured run is
GitHub Actions run `37506619630`, attempt 1, in the temporary private repository.
The report was captured before that repository was removed.

- Source revision: `6a18a7d85e7150ac0e56500bc47696724f1b3a02`
- Captured: `2026-10-06T17:58:49.101Z`
- Lockfile SHA-256: `251d67bf080b4e0c8015913bc3f66e8229af0e8763325cfa723c93629e9e3f13`
- Runner: `ubuntu-latest`, Linux `6.17.0-1022-azure`, x64, 2 logical CPUs,
  `8,322,928,640` bytes total memory
- Runtimes: Node `24.21.0` and Node `26.10.0`; pnpm `12.8.1`
- Comparison: sequential, two clean worktrees and separate pnpm stores on the
  same hosted runner

| Check | Node 24.21.0 | Node 26.10.0 | Elapsed delta (26−24) | Peak RSS delta (26−24) |
|---|---|---|---:|---:|
| Frozen install | PASS; 7,984 ms; 643,676 KiB | PASS; 5,053 ms; 354,492 KiB | −2,931 ms | −289,184 KiB |
| Typecheck | PASS; 77,853 ms; 1,070,524 KiB | PASS; 76,966 ms; 1,070,292 KiB | −887 ms | −232 KiB |
| Run-calculator budget test | FAIL (exit 1); 46 ms; 65,380 KiB | FAIL (exit 1); 44 ms; 65,400 KiB | −2 ms | +20 KiB |
| Disposable database creation | PASS; 115 ms; 65,248 KiB | PASS; 121 ms; 65,788 KiB | +6 ms | +540 KiB |
| Database schema application | PASS; 1,450 ms; 400,808 KiB | PASS; 1,359 ms; 262,392 KiB | −91 ms | −138,416 KiB |
| API integration shard 1 | PASS; 70,973 ms; 495,288 KiB | PASS; 66,976 ms; 526,668 KiB | −3,997 ms | +31,380 KiB |
| Production build | FAIL (exit 1); 66,186 ms; 1,061,728 KiB | FAIL (exit 1); 65,347 ms; 1,082,992 KiB | −839 ms | +21,264 KiB |

The workflow run itself completed successfully and uploaded the report; the
comparison status is still advisory failure because the budget test and
production build returned exit code 1 under both Node versions. Their command
output was deleted by the runner, so this evidence does not establish why they
failed. These common failures are not evidence of a Node-26-only regression, but
they prevent treating the candidate as qualified. Timing and memory deltas are
descriptive measurements from one run, not statistically meaningful performance
claims.

The exact sanitized JSON produced by the workflow is retained at
[`node-26-compatibility-comparison-2026-10-06.json`](./node-26-compatibility-comparison-2026-10-06.json).

## Compatibility findings

- Workspace metadata does not block Node 26, but the broad `>=24` declaration
  is not evidence that the whole application works on Node 26.
- The currently locked Vite and Vitest engine ranges include Node 26. Vitest
  explicitly lists the new major; this lowers declared-tooling risk.
- Existing Node 26 type definitions are not proof of runtime readiness.
- Frozen installation, typechecking, disposable database creation and schema
  application, and the selected API integration shard passed on both runtimes.
- The selected budget test and production build failed on both runtimes. Because
  the runner retains only their exit codes and measurements, their causes remain
  unresolved; neither failure can be attributed to Node 26 from this run.
- This single run found no Node-26-only failure among the measured checks, but it
  does not qualify the runtime: the overall comparison failed, the sample is
  limited to one hosted execution, and the runtime is not yet LTS.
- The workspace runtime observed on October 6, 2026 was Node 24.13.0; a
  successful GitHub comparison does not establish that the deployment platform
  supports Node 26.

## Recommendation and later promotion gates

**Recommendation: stay on Node 24.** Do not change `.nvmrc`, CI pins, package
metadata, `pnpm-lock.yaml`, the Docker base image, or release-evidence
expectations based on this advisory lane.

A separate promotion task should not begin until all of the following are true:

1. Node 26 has entered official LTS, and the project selects a then-current,
   exact patch that is older than the 24-hour release-age window.
2. The advisory comparison passes on the same source revision in at least two
   clean hosted-runner executions after LTS begins. Every check passes, or any
   shared baseline failure is separately understood and resolved; no unexplained
   Node-26-only failure remains.
3. The full required release suite passes under the proposed exact Node 26
   patch, without weakening or replacing the Node 24 baseline during the trial.
4. Replit confirms or demonstrates support for that runtime in an isolated
   deployment qualification; GitHub-hosted compatibility alone is insufficient.
5. A dedicated change updates all runtime pins coherently, including the
   rollback path and production container digest, and updates evidence
   validation only after the new baseline is explicitly approved.

No promotion, deployment, dependency repair, or default-runtime change is part
of this assessment.
