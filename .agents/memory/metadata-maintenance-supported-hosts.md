---
name: Metadata maintenance supported hosts
description: Approved operating systems and safety requirements for distillation metadata append.
---

Metadata-only append operations are approved on Linux and macOS development hosts. This approval does not extend to Windows or emulated macOS. Each operating system needs native owner-process identity and an OS kernel lock; if either cannot be established, recovery must leave existing locks untouched. macOS process-start identity uses Darwin's microsecond-resolution process start time together with the boot-session UUID.

**Why:** The owner explicitly approved macOS as an intended development runtime while keeping cross-platform stale-lock recovery fail-closed.

**How to apply:** Keep runtime support and tests host-specific. Never count Linux emulation as macOS validation; run the focused recovery tests and scripts typecheck on an actual macOS host.
