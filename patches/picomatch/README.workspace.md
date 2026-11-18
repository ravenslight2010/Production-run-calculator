# Workspace picomatch security fork

This private package is based on upstream `picomatch` 4.0.7 and retains its MIT
license. It is pinned through the root pnpm override while the upstream package
has no published fix for GHSA-fc5q-39xc-vjpf.

This is a private, first-party workspace package, not a published upstream
4.0.8 release. The `+workspace.1` version identifies the locally maintained
source. The root `workspace:*` override routes every transitive consumer to
this package. Do not replace it with the npm `latest` release while that
release is still affected.

Security coverage:

- **GHSA-3v7f-55p6-f55p:** inherited POSIX-class names cannot inject methods;
  the upstream 4.0.7 base already uses a null-prototype class lookup.
- **GHSA-c2c7-rcm5-vvqj:** the upstream base already guards overlapping
  alternatives and nested repeated extglobs under its default options.
- **GHSA-fc5q-39xc-vjpf:** the local parser change covers single-branch raw
  stars missed by upstream's repeated-extglob analysis.

The local parser avoids nested unbounded repetition when a repeated extglob body
contains a raw `*`. A single edge-star branch such as `*`, `*suffix`, or
`prefix*` is reduced to one equivalent glob expression. More complex repeated
branches containing a raw `*` are treated literally to prevent catastrophic
backtracking. This conservative behavior can change matching for those complex
patterns.

Run `pnpm --filter picomatch test` after installation. The regression suite
checks all three advisories, with malicious patterns matched in child processes
under a timeout, ordinary matching controls, and a workspace-resolution check.
The dependency scanner previously interpreted `file:patches/picomatch` as an
unknown version and flagged even the two advisories already fixed in 4.0.7.
Workspace resolution removes that ambiguous third-party file reference; it is
not a substitute for the security tests of this maintained source.

Keep the override until a published upstream release fixes the advisory. Then
remove this fork, its workspace entry, and the override, and regenerate the root
lockfile to use the verified upstream release. Do not disable default extglob
recursion protections for untrusted patterns.
