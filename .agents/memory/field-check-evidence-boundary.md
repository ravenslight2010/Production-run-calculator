---
name: Field-check evidence boundary
description: Unknown build identities and legacy field telemetry cannot establish historical write or performance causes.
---

Treat a field observation labeled `local` as an unidentified bundle, not proof
that the app ran on a development host or outside production.

**Why:** Authorized live-facility evidence contained `local` observations.
Historical failures lacked sync causes or performance sources, so even a long
duration and a nearby sync failure could not establish a common cause.

**How to apply:** Keep those records visible and explicitly uncertain. Never
convert a legacy unknown cause into a known code, infer device suspension from
elapsed time, or treat advisory field reports as revision-bound release proof.
For diagnostic deduplication, distinguish failure after recovery from replay of
the same observation; a time bucket alone cannot do that.
