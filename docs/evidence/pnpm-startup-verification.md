# Pinned pnpm startup verification

Captured: 2026-10-30, isolated task workspace. Revision: working tree based on
`a41f5b9ed`, including the subsequent startup fixes. This is development/fixture
evidence, **not deployed-environment or release-readiness evidence**. Only
version numbers, commands, outcomes and bounded diagnostics are retained; no
credentials, database records or raw production logs are included.

## Entry-point results

| Surface | Result | Evidence |
| --- | --- | --- |
| Interactive Bash | PASS | Sourcing the configured Bash startup selected the existing exact Node pin, `v24.21.0`, and the workspace Corepack shim. Both direct pnpm and its Node-spawned child returned `12.8.1`. |
| Managed artifact workflows | PASS | Web, API and component-preview workflows started using their artifact-relative launcher paths. Web and preview opened their configured ports; the API reached ready. The launcher checks the exact manager version before executing each command. |
| Nested package scripts | PASS | The real cold-cache PTY fixture ran a package script containing `pnpm --version`, returning the root pin rather than the older PATH sentinel. The API's existing nested build/start scripts also completed. |
| Post-merge | PASS, fixture only | Hook regression verifies Node selection precedes pnpm selection, frozen install and package children; phase events, retries and failures remain covered. The real hook was not executed because it installs packages and applies database setup. |
| Root deployment build/run/post-build and artifact production commands | PASS, contract only | Configuration checks route pnpm through the selector; the API audit-protection guard accepts the new launcher and still rejects missing/reordered protection. Actual deployed execution is BLOCKED below. |
| Cold acquisition with workspace-local XDG | PASS, isolated real Corepack | A disposable repository includes `packageManager`, `pnpm-workspace.yaml` and workspace-local XDG data. Corepack uses a fresh cache outside it. An older PATH pnpm sentinel is never invoked. A PTY reproduces terminal-sensitive startup, with a 60-second deadline, a 16-process session guard and fixture-group cleanup. |
| Unsafe cache/registry settings | PASS | Workspace caches, symlinked caches returning into the workspace and HTTP Corepack registries fail before manager startup, with actionable diagnostics. |
| Existing release-runner bootstrap | PASS, focused case | `bash scripts/src/run-release-node.test.sh` reported: “pnpm uses the packageManager pin, runs children with pinned Node, and removes its isolated cache”. The broader suite subsequently hit the IPv6 limitation below. |

The configured Node-selection path, root `packageManager`, lockfile,
`pnpm-workspace.yaml`, and Nix tool policy were not changed. The selector keeps
Corepack integrity checks enabled, requires HTTPS for its acquisition registry,
and disables only the download-confirmation prompt. Existing historical pnpm
tool caches and temporary directories were not deleted. Only disposable
fixture-owned files/process groups were cleaned up.

## Focused checks

Passed:

```sh
bash scripts/src/run-release-node.sh pnpm --filter @workspace/scripts exec node --test ./src/check-replit-node-runtime.test.mjs ./src/check-audit-protection-config.test.mjs
node scripts/src/check-audit-protection-config.mjs
bash scripts/src/check-shell-inventory.sh
shellcheck scripts/src/configure-project-pnpm.sh scripts/src/run-project-pnpm.sh scripts/post-merge.sh
git diff --check
```

The focused Node run passed 16 tests. The maintained shell inventory covers 36
scripts; the full `check:shell` command also passed during this task. A
development-preview screenshot confirmed that the unauthenticated landing page
renders after the workflows start. Expected unauthenticated API responses are
not evidence of signed-in functionality.

No UI, authorization, sync, stored-data or schema behavior was changed.
Chromium/WebKit journeys and physical-device compatibility checks are not
applicable to this shell/configuration change; the screenshot is visual startup
evidence only.

## Failure ledger and limitations

| Finding | Disposition / owner / next action |
| --- | --- |
| Fixture cache-link cleanup escaped the fixture's unique parent | FIXED: all unsafe-cache fixture paths now live under one disposable parent; repeated runs pass. No historical tool cache was removed. |
| Artifact-managed development commands execute inside their artifact directories | FIXED: development commands use `../../scripts/src/run-project-pnpm.sh`; fixture checks exercise each actual configured path from an artifact directory, and all three real workflows start. |
| Corepack download confirmation blocked a terminal-backed workflow | FIXED: disable that prompt for the approved exact pin, preserving verification; real cold-cache PTY coverage now exercises it. |
| Publish audit-protection guard recognized only bare pnpm | FIXED: recognize both the existing command and the pinned launcher without changing the required protection-before-server ordering. |
| Full release-runner regression cannot bind `::1` (`EAFNOSUPPORT`) | BLOCKED after the relevant pnpm bootstrap case passed. Owner: validation-environment maintainer. Next action: rerun the unchanged full runner suite on a host with IPv6 loopback support. No TLS assertions were weakened. |
| `check:workflows` finds Project launches `test:client` as well as `release:standard` | FAIL, pre-existing configuration outside startup selection. Owner: project workflow maintainer. Next action: reconcile the Project run-button contract separately; this task preserves that existing aggregate workflow. |
| Fresh Replit workspace shell and deployed build/run/post-build | BLOCKED: those environments are not available in this fork and no publish is authorized. Owner: environment/release operator. Next action: use the normal authorized environment lifecycle to record executable/version selection there. Fixture and managed-development results do not establish deployment parity. Artifact production commands retain the repository-root command convention; its effective deployed working directory remains unverified. |
| Unrelated automatic operational diagnostics | NOT INVESTIGATED: the log feed included background database-timeout warnings and existing master-data findings. Owner: operational/data-health maintainer. Next action: assess through the existing operational reports; no production repair or data change was attempted for this startup task. |

Supported commands use the configured shell shim or the project launcher.
Explicit absolute-path invocation of an obsolete system pnpm bypasses these
entry points and is not claimed safe; changing global tools or workspace
package-manager policy to intercept such bypasses is outside the approved scope.
