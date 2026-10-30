---
name: Same-field sync conflict policy
description: Owner-approved handling for conflicting offline run-value edits.
---

For a same-field offline conflict, preserve the canonical server value and discard the conflicting local edit. Do not retain or replay that conflicting value automatically. Independent nonconflicting edits may still be rebased through the existing recovery flow.

**Why:** The owner chose server-wins/discard-local on 2026-10-29. A policy decision does not prove that a particular browser or physical-device recovery path applies the value correctly; keep implementation evidence revision-bound.

**How to apply:** Use this rule when a stale-base recovery identifies a same-field conflict. Preserve independent edits, make the discard outcome visible, and verify the current form and stored state converge before describing the path as passing.
