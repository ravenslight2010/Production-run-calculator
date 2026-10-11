# Isolated Screen-Off/Wake Regression Result

- **Result:** PASS — all 15 currently enumerated cases passed; no cases were filtered or dropped.
- **Recorded:** 2026-09-28T02:22:29Z.
- **Environment:** Isolated browser validation with a disposable local PostgreSQL cluster. The runner's exit trap stopped and removed the cluster; no matching temporary cluster directory remained after the run. No production data was used.
- **Revision identity:** base commit `06db556ef86a966528eee50cd053f4f9101ea3e2`; SHA-256 of the tested source diff `c62a1a0ca1793376a3b2c1583978d441e1e600cd846938111580acdbab8b682e`.

## Checks

- Screen-off/wake browser journey (`screen-off-wake.spec.ts`): **15 passed** in 4.2 minutes.
- Focused API foreground-projection regressions: **2 passed**.
- Focused client wake, sync, Packaging, scheduler, and live-run checks: **126 passed** across 11 files.
- `pnpm run typecheck`: **passed**.
- The broader sync API regression set reported **162 passed, 1 failed**. The remaining failure is the unrelated snapshot-anchored peer-frame case, `sends a materially smaller snapshot-anchored frame for a one-run peer update` (expected `changed-pepTypes`; received `undefined`). It is outside this task's scope and remains visible for the dependent release-evidence work.

## Reproduction

```bash
scripts/src/run-isolated-browser-suite.sh \
  --playwright-config=playwright.release-debug.config.ts \
  e2e/screen-off-wake.spec.ts
```

The isolated runner created a fresh PostgreSQL cluster under `/tmp`, enabled only its E2E destructive-test guards, applied the schema there, and removed the cluster on exit. This report is test evidence only; it is not production or release-readiness evidence.