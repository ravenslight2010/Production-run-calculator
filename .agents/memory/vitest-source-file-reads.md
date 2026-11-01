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
