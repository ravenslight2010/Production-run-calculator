---
name: Mobile require-cycle module-init crash
description: Metro require cycles make module-scope constants read undefined at init; use lazy getters in mobile shared modules.
---

# Require cycles in the mobile (Metro) module graph

A require cycle between mobile modules (e.g. `context/sync/mapping.ts` ↔ its
importers) makes a module-scope constant evaluate while its source module is
still partially initialized — the value is `undefined` at module init and every
consumer captures that undefined forever. On Expo web this can blank the whole
app with no ErrorBoundary catch.

**Why:** Metro tolerates require cycles with a warning; the failure is silent
data corruption at init time, not a thrown error.

**How to apply:** In mobile modules that both import from and are imported by
the app graph, don't snapshot shared constants at module scope (e.g.
`EMPTY_FORM_VALUES`). Read them lazily inside the function that needs them, or
via a getter. If the Expo web build goes blank after touching sync/mapping
modules, check the Metro "require cycle" warnings first.
