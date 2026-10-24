---
name: Replit migration boundaries
description: Publish owns managed production schema changes; direct SQL rehearsals do not establish Publish compatibility.
---

Use the supported Publish schema-diff flow for managed production databases.
Do not add deployment-build or startup-time DDL to work around a failed diff.

**Why:** A direct serial-to-identity conversion can pass its disposable rehearsal
while Publish still generates a conflicting sequence creation against production.
The user explicitly approved restoring development compatibility instead of
changing production outside Publish. Earlier advice in this note to run custom
DDL before serving was unsafe under the supported migration policy and is retired.

**How to apply:** Development and CI now run the preservation-safe
serial-to-identity conversion before Drizzle. Keep that ordering and preserve
rows, grants, generator high-water marks, and explicit-ID headroom when changing
it. This does not establish production Publish compatibility: recompute and
inspect the actual Publish diff before publishing, and never apply the helper to
production outside the supported flow. If a required trigger/function cannot be
represented by that flow, report the limitation rather than inventing a
production DDL path.

Do not treat Drizzle push's process exit status as proof that its SQL succeeded.

**Why:** A disposable legacy serial-to-identity rehearsal printed a sequence-name
collision yet returned zero, allowing the package's `&&` chain to continue.
Rows surviving the later helper also failed to reveal advanced-counter rewind.

**How to apply:** Check SQL diagnostics and catalog/counter/grant postconditions
independently of exit status. Include populated and advanced-empty generators;
stored `MAX(id)` alone cannot attest previously issued sequence progress.
