---
name: Release Node pinning
description: How release validation discovers the Node runtime used by child scripts and retained evidence.
---

Release validation records the Node runtime from the `node` executable used by package scripts. Wrapping or launching pnpm with a pinned Node binary is insufficient when child commands resolve `node` from PATH.

**Why:** A release run launched through a Node wrapper still reported the workspace default Node version until the pinned executable was placed first on PATH; corpus and routine-evidence gates then failed against the retained Node 24.20.0 manifest.

**How to apply:** For release validation, prepend the pinned Node directory (or a pinned `node` shim) to PATH before invoking pnpm, then verify both `node --version` and a package-script invocation before trusting evidence.