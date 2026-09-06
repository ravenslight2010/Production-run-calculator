---
name: Retired AI data retention
description: Durable boundary between disposable generated data and protected operational or correction records.
---

Retired AI cleanup must begin by closing every writer. Generated conversation and facility-grounding pools may expire or be deleted by explicit allowlist; privacy-sensitive images should have the shortest useful retention.

**Why:** A one-time marker cannot protect privacy if an old feature can repopulate its target after cleanup, and broad table cleanup can destroy correction memory or operational audit history.

**How to apply:** Keep generated payload cleanup scope-aware, bounded, dry-run visible, transactional, and marker-guarded. Preserve incident rows, human notes, confirmed quality history, inventory ledger effects, import evidence, aliases, and denied matches; label retained model prose as unverified.