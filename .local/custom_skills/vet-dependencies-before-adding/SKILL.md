---
name: Vet dependencies before adding
description: Use this skill when adding, upgrading, or installing any third-party package or library (npm, pip, etc.), or when the user asks to add a dependency.
---
**Activation:** On-demand — Agent loads this when you add/upgrade a package. Agent-actionable: it verifies the package and runs the audit itself.

# Instructions

AI suggestions sometimes invent package names or pick near-miss typosquats. A wrong package means malware or a broken build. Before writing any package name into a manifest:

- Confirm the package actually exists in its registry. If you cannot confirm it exists, do not add it — tell the user it may be hallucinated and ask what they meant.
- Check it is the genuine, widely-used package, not a typosquat (e.g. a one-character variation of a popular name like `lodahs` for `lodash`). If the name is suspiciously close to a well-known package, stop and confirm with the user.
- Treat brand-new, very low-download, or deprecated packages as a warning. Surface this to the user before adding rather than adding silently.
- Prefer a library the project already depends on if it solves the problem. Every new dependency is new risk and maintenance.
- Pin the version and keep the lockfile committed. Do not introduce floating ranges like `*` or `latest` in production manifests.
- After installing, run the project's vulnerability audit (e.g. `npm audit`, `pip-audit`) and report the result. Treat high or critical advisories as blockers: upgrade to a fixed version or get explicit approval to accept the risk. Do not pin around a fix just to avoid a refactor.
- On Replit, also run the Project Security Center scan and use "Fix with Agent" on dependency findings before publishing.

When done, report for each new dependency: that it was verified to exist, the pinned version, and the audit result. Never say "added X" without the verification result.
