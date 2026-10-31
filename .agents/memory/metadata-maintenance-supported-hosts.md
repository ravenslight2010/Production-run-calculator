---
name: Metadata maintenance supported hosts
description: Approved operating systems and safety requirements for distillation metadata append.
---

Metadata-only append operations are approved on Linux, native macOS, and native Windows x64 development hosts. Windows approval is limited to local fixed NTFS with Windows PowerShell 5.1. This approval does not extend to other maintenance commands or emulated-host validation. Each operating system needs native owner-process identity and an OS kernel lock; if either cannot be established, recovery must leave existing locks untouched. macOS process-start identity uses Darwin's microsecond-resolution process start time together with the boot-session UUID.

**Why:** The owner independently approved macOS and Windows as metadata-command development runtimes while keeping cross-platform stale-lock recovery fail-closed and other commands outside that approval.

**How to apply:** Keep runtime support and tests host-specific. Never count Linux emulation as macOS or Windows validation; run focused recovery tests and scripts typecheck on the actual supported host. Preserve all approved host branches when integrating parallel platform changes.

Canonicalize temporary fixture roots when testing repository-boundary guards across operating systems. macOS may expose the same directory through `/var` and `/private/var`; do not weaken the application's boundary checks to accommodate a fixture alias.

**Why:** A real macOS run passed the native lock cases but rejected a synthetic repository whose temporary root used a different spelling from its real path.

**How to apply:** Resolve the created temporary directory before deriving in-repository and outside-repository fixture paths. Keep outside-root rejection tests intact.
