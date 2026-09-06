---
name: Operations API compatibility window
description: How deterministic Operations Insights contracts coexist temporarily with legacy AI-named aliases.
---

Permanent deterministic operation contracts must use provider-neutral names and response fields. Retired AI-named endpoints may remain only as temporary aliases for supported older clients, and only those aliases should emit legacy AI status metadata.

**Why:** Removing old routes immediately would strand supported clients, while publishing their compatibility fields in the permanent contract would keep deterministic operations misleadingly coupled to AI.

**How to apply:** Migrate current clients first, keep aliases on the same handlers and rate-limit buckets, exclude compatibility metadata from permanent generated contracts, and remove aliases only after the supported-client window is verified closed.