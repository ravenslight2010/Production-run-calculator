---
name: Vitest source-file reads
description: Filesystem-based source contracts need an explicit filesystem root rather than assuming a transformed URL is a file URL.
---

For filesystem-based source contracts, resolve against the package/workspace
root established by the test runner. Do not assume a static
`new URL(..., import.meta.url)` reference to a TypeScript source remains a
`file:` URL after Vite/Vitest processing.

**Why:** A local-source read failed with a non-file URL scheme before reaching
its assertion. Explicit package-root filesystem resolution reached the intended
regression without changing application asset handling.

**How to apply:** Use the canonical package-scoped invocation or supply an
explicit root when testing from another working directory. Keep this separate
from browser asset URLs and do not hardcode a machine-specific absolute path.

When testing an interval callback that schedules a zero-delay timeout, Vitest's
fake clock may require advancing one additional millisecond after reaching the
interval deadline to execute that newly scheduled timeout.

**Why:** A sync-outbox fallback test reached the poll callback at the exact
five-second boundary, but its queued drain remained pending until the clock
advanced again; the production poll behavior was intact.

**How to apply:** In fake-timer tests, distinguish the interval that requests
work from the timeout that performs it. Advance through both timer turns and
assert the observable result, rather than interpreting a boundary-only miss as
a product failure.
