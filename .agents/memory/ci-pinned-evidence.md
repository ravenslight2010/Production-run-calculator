---
name: CI-pinned evidence refresh
description: Retained evaluation manifests bind evidence to the CI Node runtime and lockfile.
---

When the CI Node pin or lockfile changes, refresh every retained evaluation manifest that records those dependencies together; exact-equality checks treat stale metadata as a real failure.

**Why:** Library and routine-script gates compare generated metadata with checked-in evidence, so one stale runtime or lockfile field blocks otherwise valid code.

**How to apply:** Before merging dependency or CI runtime changes, search retained evaluation reports and snapshots for the old Node version and lockfile hash, then regenerate or update only the bound metadata fields.