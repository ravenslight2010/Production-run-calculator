---
name: Section-scoped online edits
description: Correctness and recovery rules for short-lived peer ownership of grouped operational fields.
---

Transient acquire/release events improve peer UX but are never the race boundary. Serialize against the canonical daily row and compare every field in the protected section to a complete pre-edit baseline.

**Why:** A peer event can be delayed, missed, or expire. Partial baselines allow two controls representing one operational fact to diverge, while optimistic values can bypass ownership through ordinary snapshot synchronization.

**How to apply:** Persist uncertain or offline section commands with the original owner/scope, id, date, reset epoch, and baseline. Partition timers and active fences by owner plus request token, and recheck identity after every async boundary so an old response cannot affect a new session. Until canonical resolution, remove the entire grouped section from ordinary snapshot writes. Bound automatic retries; an exhausted command stays durably fenced and is skipped by reconnect retries. A later explicit edit may replace it only after the replacement is durably stored. Broadcast canonical data before release, and release in a guaranteed completion path after success, conflict, failure, or disconnect.

An explicit end to a manual tracking hold is a server control acknowledgement, not a new manual correction. Preserve its correction generation and do not replay held time. Retrying a control must never retire an uncertain correction.

**Why:** Reusing a correction to request Resume renews a server-owned hold, while a browser-only rearm cannot restart passive, server-owned progress. A late control acknowledgement must not force its old count pair over a newer correction.

**How to apply:** Bind hold controls to the acknowledged run lifecycle and correction generation, retain retry identity, and require canonical proof. Gate held automatic claims before scheduling them so one rejected station claim cannot prevent unrelated bookkeeping from being committed.