---
name: CI-pinned evidence refresh
description: Retained evaluation manifests bind evidence to the CI Node runtime and lockfile.
---

When the CI Node pin or lockfile changes, refresh every retained evaluation manifest that records those dependencies together; exact-equality checks treat stale metadata as a real failure.

**Why:** Library and routine-script gates compare generated metadata with checked-in evidence, so one stale runtime or lockfile field blocks otherwise valid code.

**How to apply:** Before merging dependency or CI runtime changes, search retained evaluation reports and snapshots for the old Node version and lockfile hash, then regenerate or update only the bound metadata fields.

Retained evaluation artifacts may use different envelopes: deterministic snapshots can be the manifest root, while provider-backed evidence can wrap it under `evaluationManifest`. Shared metadata checks must normalize both shapes and fail closed when neither contains a valid runtime.

**Why:** Treating every artifact as wrapped evidence caused the deterministic corpus snapshot to bypass the runtime contract.

**How to apply:** When adding a retained evaluation artifact, identify whether its manifest is root-level or nested and cover that shape in the shared contract tests without rewriting the evidence.