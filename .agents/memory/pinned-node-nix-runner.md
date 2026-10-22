---
name: Pinned Node in Nix
description: Recover release-runner checks when the pinned Node version is installed but not selected by the shell.
---

When `run-release-node.sh` falls back to `npx` and fails to provision the requested Node version, check whether that exact Node version is already installed in `/nix/store`. If it is, prepend its `bin` directory to `PATH` before invoking the runner again.

**Why:** This workspace can have a pinned Node release available in the Nix store while the shell selects an older Node release. The runner only uses an installed version directly when it is already first on `PATH`, so otherwise it may attempt an unnecessary `npx` download that can run past the shell timeout before tests start.

**How to apply:** After a provisioning failure or a test command that appears stuck before producing test output, inspect `node --version` and locate the required version under `/nix/store`; use the matching binary directory on `PATH` for the unchanged validation command. Do not bypass the release runner's version and evidence checks.

The workspace-global `pnpm` launcher can have an absolute shebang pointing at a different Node build even after the pinned Node is first on `PATH`. Do not infer the runtime used for package-script children solely from the `pnpm` process path; inspect the launcher and verify the release runner's selected Node separately.

**Why:** The launcher is generated with its interpreter path, while child tools resolve `node` through the updated `PATH`; these can report different executable paths during the same check.

**How to apply:** If process listings appear inconsistent after pinning Node, inspect `head -1 "$(command -v pnpm)"` and the release runner preflight result before changing toolchain configuration.

The Replit npm package-firewall registry may be configured as cleartext HTTP, while release bootstrap intentionally rejects HTTP downloads. For pinned-Node acquisition, explicitly select an HTTPS npm registry instead of weakening the transport guard.

**Why:** The HTTP registry setting caused post-merge setup to fail before dependency installation even though the pinned runtime package was available from the public HTTPS registry.

**How to apply:** Keep HTTPS certificate verification and downgrade rejection enabled; scope the HTTPS registry override to Node package acquisition, and test that inherited HTTP configuration cannot override it.

Concurrent task merges can launch multiple pinned-Node `npx` acquisitions against the same npm exec cache. npm may report its timed-out acquisition lock as `ECOMPROMISED`; this is not by itself proof of corrupted package contents.

**Why:** Parallel post-merge hooks share the user npm cache even when each task has an isolated workspace, so one wait can exceed npm's lock deadline.

**How to apply:** Give each short-lived Node bootstrap a private temporary npm cache and remove it with the bootstrap's temporary marker directory. Do not clear or mutate the shared cache to recover from a lock timeout.

If a pinned Node command reports mutually exclusive CA modes, keep the mode selected by the Node build and inherited `NODE_OPTIONS` consistent through the launcher and its child processes. When the build uses OpenSSL CA mode, keep system-CA mode disabled and provide readable host CA file/directory paths.

**Why:** npm-provisioned Node builds can default to OpenSSL CA mode, while `NODE_USE_SYSTEM_CA=1` or a conflicting `NODE_OPTIONS` flag can request the opposite mode and fail even for `node --version`.

**How to apply:** Inspect the selected Node build, `NODE_USE_SYSTEM_CA`, and inherited `NODE_OPTIONS`; align their CA modes across acquisition and child processes. For OpenSSL mode, set readable `SSL_CERT_FILE` and `SSL_CERT_DIR`. Keep HTTPS certificate verification enabled and verify both bootstrap and the selected runtime.
