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

Filtered field evidence must not borrow lifetime issue counts or recovery from
outside its selected population. Preserve the distinction between lifetime
issues and retained-population evidence, and keep it visible to managers.

**Why:** Facility issue history is not attributed to individual build/browser
groups. A healthy newer build can otherwise hide failures in an older unknown
build, while filtering just a few global recent rows can miss that group entirely.

**How to apply:** Scope matching observations before summarizing or limiting
rows. Recovery needs later success in that same population; label bounded
retention and never present the result as a revision-bound release gate.

Manager browser assertions that combine a check title with its coverage and
issue state should select the complete check card, not the title's immediate
parent; the title is nested inside a smaller header.

**Why:** A title-level locator can resolve successfully while excluding the
coverage and issue-state text the test intends to verify.

**How to apply:** Anchor the assertion to the whole rendered check card and use
the catalog label verbatim, including punctuation.
