# Workspace picomatch security fork

This private package is based on upstream `picomatch` 4.0.7 and retains its MIT
license. It is pinned through the root pnpm override while the upstream package
has no published fix for GHSA-fc5q-39xc-vjpf.

The parser now avoids nested unbounded repetition when a repeated extglob body
contains a raw `*`. A single edge-star branch such as `*`, `*suffix`, or
`prefix*` is reduced to one equivalent glob expression. More complex repeated
branches containing a raw `*` are treated literally to prevent catastrophic
backtracking. This conservative behavior can change matching for those complex
patterns.

Keep the override until a published upstream release fixes the advisory. Then
remove this fork and update the root lockfile to the upstream release.
