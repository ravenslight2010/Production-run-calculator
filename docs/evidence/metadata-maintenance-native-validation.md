# Native metadata maintenance validation

## Result and scope

Final-source validation: PASS on Linux x64, macOS Apple silicon, and
macOS Intel. Captured on
2026-10-23 UTC using isolated hosted CI and synthetic fixtures only.
No real backfill, private evidence inspection, production access, deployment,
or default-branch merge was performed. These are CLI/runtime checks, not
application release approval or browser/mobile evidence.

The owner approved macOS development support and a temporary validation-only
branch/PR. The draft [validation PR](https://github.com/ravenslight2010/Production-run-calculator/pull/130)
targeted a temporary workspace baseline, not `main`. It was closed without
merging, and both temporary remote branches were removed after exact-tip
verification. The default branch was not changed.

## Native results

The [final-source metadata workflow](https://github.com/ravenslight2010/Production-run-calculator/actions/runs/39885734230)
started at 2026-10-23T01:44:52Z and reported success at
2026-10-23T01:48:25Z. Every native job passed frozen dependency install, the
focused distillation suite, referenced-library declaration generation, and
scripts typecheck through `scripts/src/run-release-node.sh`.

| Runner | Observed platform/architecture | Node | pnpm | Python | Result |
| --- | --- | --- | --- | --- | --- |
| ubuntu-latest | Linux / x64 | 24.21.0 | 12.8.1 | 3.12.15 | PASS |
| macos-15 | Darwin / arm64 | 24.21.0 | 12.8.1 | 3.12.10 | PASS |
| macos-15-intel | Darwin / x64 | 24.21.0 | 12.8.1 | 3.12.10 | PASS |

Native job IDs: Linux `120193361925`, Apple silicon `120193362250`,
Intel `120193362354`. Final-source job logs explicitly printed the observed OS, architecture,
Node, pnpm, and Python versions; neither macOS result is Linux emulation.

The separate [workflow policy/lint run](https://github.com/ravenslight2010/Production-run-calculator/actions/runs/39885734270)
also passed. Actions are pinned, permissions are read-only, and this validation
uses no shared dependency cache or repository secret inputs.

Commands executed after `pnpm install --frozen-lockfile`:

```sh
bash scripts/src/run-release-node.sh pnpm --filter @workspace/scripts exec tsx ./src/distill-backfill.test.mts
bash scripts/src/run-release-node.sh pnpm run typecheck:libs
bash scripts/src/run-release-node.sh pnpm --filter @workspace/scripts run typecheck
```

## Covered behavior

- Live structured owner and active recovery gate retain their locks.
- Process-start mismatch distinguishes a reused live PID.
- Dead structured and legacy PID-only owners can be recovered.
- Live legacy PID-only, malformed update/recovery, foreign or unavailable
  process identities remain fail-closed.
- Recovery after a killed gate holder and concurrent synthetic append attempts
  preserve acknowledged history without losing a successful append.
- Existing history and non-history fields are preserved; invalid dates/notes
  do not change the decision file.
- Atomic replacement remains in the original directory using an fsynced
  temporary file. No private input is needed by any recovery case.

## Source binding

Tested source fingerprints below are the primary task-input identity.
The validation snapshot `0a2c0ca1905c73ebbad075ba0c1b3e7ce477cf02`
has exactly source tree `636eb544a0db6a7c55ab12f24486feef46a9a59b`,
matching local source commit `fa796b6dee7c11506a3eca7310e1bf266f160865`.
Subsequent edits are documentation/evidence or agent-memory updates only.

| Input | SHA-256 |
| --- | --- |
| scripts/src/distill-backfill.mts | `96e8adae6bab4c070a8de02629cc4a30d402709678b009681ec4679310e82620` |
| scripts/src/distill-backfill.test.mts | `e4b25c0db309a47116ed9a8946caf3388670238e4fb1eb6c257254ce9140a802` |
| scripts/src/metadata-process-identity.mts | `46cacd3ddc95f8c18747aca8105cd823ea9c98ef496cf16e7e09766ee0eaa303` |
| scripts/src/metadata-darwin.py | `2e3fcb0bd1b3fd570f78b4793867e6c911e351bfb10b478ec28146ec20e05200` |
| scripts/src/run-release-node.sh | `98a3a2f3834266f76eec04a55e1c569920475a6ff41d0355778dcf80f0788801` |
| scripts/src/run-release-darwin.py | `a7340c4c8964cb39f76386661986919fa82878164ea305124fdbb85f76020379` |
| .github/workflows/metadata-maintenance-macos.yml | `970d265c256d0081747cdc107c717274d7bc67e66ffa8ee5c41b04c5dec02f57` |
| pnpm-workspace.yaml | `a134c06377b97b2847aa57ef9e63e5c4a15550eba5913f646cf7fd2cc4bb934b` |
| pnpm-lock.yaml | `5bd4b9f3ba2e4fca39635523147301f68c9f45ff1662ee3ca604676437aa8676` |

## Failure closure and limits

- Initial Linux synthetic identity failure exposed a test seam that also
  intercepted the new writer's identity. The seam now affects owner inspection
  only; the final Linux/macOS suites pass.
- The first Apple silicon run exposed `/var` versus `/private/var` aliases in
  fixture paths. Canonicalizing the fixture root fixed it without weakening
  repository containment. The first run is not counted as passing evidence.
- Workflow lint initially rejected an unscoped pnpm cache. Removing the cache
  resolved the failure; the final policy/lint run passes.
- Final acceptance review moved foreign-platform identity rejection ahead of
  the local PID lookup. Live and absent local PIDs are both tested for update
  and recovery lock files; neither can establish a foreign owner's identity.
- Local pinned-runner/frozen-install attempts timed out, and local actionlint
  was unavailable. The successful exact-version hosted installs, tests,
  typechecks, and policy/lint run supersede those incomplete local checks.
- An inactive Git packed-refs temporary file was preserved outside `.git` to
  resolve local maintenance warnings. A mismatched configured push URL was
  rejected without mutation; the already authenticated host/helper provided
  the authorized repository route. Its LFS upload endpoint was unavailable.
  Neither validation tree contains LFS files; only unrelated historical LFS
  uploads were omitted for these source-only, never-merge validation branches.
- Unrelated release/browser workflows automatically triggered by the temporary
  PR were intentionally cancelled. No release or browser pass is claimed.
- The separate completion gate initially failed before TypeScript started:
  a dangling user Corepack launcher selected older Nix pnpm, whose recursive
  bootstrap crashed. The dangling launchers were preserved and the exact
  repository-pinned pnpm was provisioned in the existing user-tools PATH.
  No project dependency or configured-check waiver was used.

All required native checks passed. The separate completion gate runs the full
repository typecheck; its result is not inferred from these native checks.
Windows remains outside this
approved runtime contract and has separate work; older macOS releases and
unlisted Python combinations were not validated here.
