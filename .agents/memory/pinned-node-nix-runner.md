---
name: Pinned Node in Nix
description: Recover release-runner checks when the pinned Node version is installed but not selected by the shell.
---

When `run-release-node.sh` falls back to `npx` and fails to provision the requested Node version, check whether that exact Node version is already installed in `/nix/store`. If it is, prepend its `bin` directory to `PATH` before invoking the runner again.

**Why:** This workspace can have a pinned Node release available in the Nix store while the shell selects an older Node release. The runner only uses an installed version directly when it is already first on `PATH`, so otherwise it may attempt an unnecessary `npx` download.

**How to apply:** After a provisioning failure, inspect `node --version` and locate the required version under `/nix/store`; use the matching binary directory on `PATH` for the unchanged validation command. Do not bypass the release runner's version and evidence checks.
