---
name: Release Node pinning
description: How release validation discovers the Node runtime used by child scripts and retained evidence.
---

Release validation records the Node runtime from the `node` executable used by package scripts. Wrapping or launching pnpm with a pinned Node binary is insufficient when child commands resolve `node` from PATH.

**Why:** A release run launched through a Node wrapper still reported the workspace default Node version until the pinned executable was placed first on PATH; corpus and routine-evidence gates then failed against the retained Node 24.20.0 manifest.

**How to apply:** For release validation, prepend the pinned Node directory (or a pinned `node` shim) to PATH before invoking pnpm, then verify both `node --version` and a package-script invocation before trusting evidence.

Replit's Node major module does not guarantee the evidence-bound patch, including after a workflow restart. **Why:** The workspace can expose an older patch than the retained evidence and CI pin despite declaring the correct major. **How to apply:** Select the exact patch at each validation or setup entry point and fail closed when it cannot be obtained; do not assume a fresh terminal inherited the workflow's PATH.

On a fresh workspace, Corepack may prompt to download the pinned pnpm package on its first invocation, which can stall non-interactive validation before any child command starts. **Why:** The Node pin and package-manager cache are independent. **How to apply:** Resolve the configured package manager once (for example, with `pnpm --version`) before starting a parallel validation batch.

Large validation batches can also exceed the workspace's process/thread limit: Rust-backed pnpm or test tooling may abort while creating Rayon/Tokio workers with `WouldBlock` / “Resource temporarily unavailable,” even when focused checks pass in isolation. **Why:** Each concurrent gate starts its own runtime and worker pool. **How to apply:** Re-run the relevant gate serially to distinguish resource exhaustion from a code failure; do not weaken checks or change runtimes to hide an aggregate-runner limit.