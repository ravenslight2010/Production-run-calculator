---
name: Browser check boundaries
description: Index of authentication timing, isolated browser matrices, picker scoping, and storage fixture decisions.
---

Use the relevant detailed decision when browser evidence depends on timing,
execution isolation, control visibility, or client storage availability.

**Why:** These constraints distinguish test-environment failures from actual
application defects and prevent misleading browser evidence.

**How to apply:** Open the matching topic before changing its fixture or
interpreting a failure:

- [Slow-network auth timing](slow-network-auth-timing.md) — include session confirmation in authenticated cold-start measurements with a bounded wait suited to the network profile.
- [Isolated browser matrices](browser-matrix-isolation.md) — when a multi-project suite times out after its first profile, rerun the failed profile alone before treating it as a browser defect.
- [Browser picker assertions](browser-evidence-assertions.md) — scope queries to the active touch dialog; hidden closed-dialog inputs may match global selectors.
- [Browser storage](browser-localstorage-availability.md), [phone forms](phone-e2e-form-overrides.md), and [query coercion](orval-query-coerce-quirk.md) — guard unavailable localStorage and missing query parameters.
