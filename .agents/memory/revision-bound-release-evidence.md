---
name: Revision-bound release evidence
description: How managed rebases and concurrent validators affect release evidence attribution.
---

Release evidence is only trustworthy when the report, state file, browser report, and current revision all match. A managed rebase can occur during completion validation, making an otherwise complete report stale; a standard and full release run launched concurrently can also contend on the disposable test database and create misleading infrastructure timeouts.

**Why:** Completion validation may update HEAD and invoke multiple release commands in parallel. Old reports then fail revision checks, while concurrent API shards can time out before the browser gate even runs.

**How to apply:** After any managed rebase, run exactly one isolated full release assessment at the new HEAD. Wait for its terminal result, reconstruct failed/incomplete browser evidence when the reporter intentionally retains only passing baselines, verify standard and full evidence separately, and do not hand-edit revision hashes.

Browser reporters and the release orchestrator must share the same evidence root; a valid full run written to the standard root looks stale to full validation. Run standalone verification in the matching full mode when checking full evidence.

**Why:** The browser gate can pass all cases while the release gate rejects the report solely because the reporter defaulted to a different root, or because standard-mode verification expected one fewer full-run gate.

**How to apply:** Pass the resolved full report path into full browser runs and invoke the verifier with full mode for full evidence; treat path or mode mismatches as infrastructure defects, not browser failures.