---
name: Sync snapshot identity
description: Conditional live-sync reads and writes use a server-owned stable hash of canonical day state.
---

The server is the authority for sync snapshot identity: hash the canonical, protected JSON with recursively sorted object keys. Clients may skip applying a response only after the server explicitly returns `unchanged` with that identity.

**Why:** Client payload signatures do not include server-side LWW protection, normalization, or merge results, so using them as canonical identities can hide a required reconciliation.

**How to apply:** Keep conditional checks after authorization, payload validation, client-date selection, and reset-epoch checks. Legacy clients must still receive the full raw payload when no valid matching snapshot is supplied.