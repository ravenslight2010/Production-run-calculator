---
name: Source-audit CLI paths
description: Source-library audit commands must resolve repository inputs independently of the caller's working directory.
---

Source-library audit CLIs should derive the repository root from their module location, not from `process.cwd()`.

**Why:** Package-manager wrappers usually run these commands from `scripts/`, while reviewers and smoke tests may launch them from the repository root; a cwd-based parent-directory assumption can silently select the wrong source corpus or fail against a neighboring directory.

**How to apply:** Keep default inputs rooted at the repository containing `scripts/src`, and send any required generated reports to disposable output paths in root-invocation smoke tests.