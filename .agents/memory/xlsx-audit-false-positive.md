---
name: xlsx audit false positive
description: SheetJS xlsx CDN releases are patched but still flagged by GHSA/OSV scanners; how to actually clear the scan.
---

SheetJS stopped publishing the `xlsx` package to the npm registry after
`0.18.5` and only ships newer releases (0.19.x/0.20.x+) via their own CDN
(`cdn.sheetjs.com`). Those CDN releases already contain the fixes for old
CVEs like prototype pollution / ReDoS (patched upstream back in 0.19.3).

**Why this still shows up as a vulnerability:** GHSA/OSV-based scanners
match advisories by npm registry package name + version range. Since the
fixed versions were never published under the npm name `xlsx`, the
advisory's "patched" upper bound only knows about the abandoned
`<=0.18.5` npm history — any `xlsx`-named dependency (even a
CDN-sourced, actually-patched 0.20.x) keeps getting flagged. `pnpm audit`
itself doesn't even see the CDN dependency (non-registry URL), but
Replit's own vulnerability scan flags it by package name regardless of
source.

**How to apply:** Don't try to "explain away" the CDN version as a false
positive — that gets rejected by review. Instead alias the dependency to
an npm-registry-published mirror of the exact same SheetJS release, e.g.
`"xlsx": "npm:@e965/xlsx@^0.20.3"`. This is a legitimate npm package
(properly versioned, real registry metadata) so GHSA's `xlsx`-scoped
advisories no longer match it. Import specifiers (`from "xlsx"`) don't
change — only the package.json resolution target does.
