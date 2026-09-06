---
name: Operational read-model integrity
description: Source-of-truth and provenance rules for server-derived operational views and their offline fallbacks.
---

Canonical operational reports must fail closed when any included snapshot or run cannot be derived unambiguously. Never omit rejected facts and still label the remaining aggregate authoritative. Point-in-time projections remain advisory and must never write counters or inventory observations.

**Why:** A partial aggregate can look complete while silently excluding a malformed run. A local fallback can also become misleading if its exported or shared text inherits an authoritative label from the server-backed format.

**How to apply:** Derive server views only from the scoped canonical sync snapshot, include freshness and versioned formula provenance, reject ambiguous period reports atomically, and carry authoritative versus local/offline provenance through display, download, clipboard, and native share paths.