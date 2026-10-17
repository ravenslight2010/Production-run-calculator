# AI Corrections and Evaluation Data Audit

**Date:** 2026-10-02  
**Scope:** Reviewed spec, cheese, premix, and schedule-import matching confirmations; correction-memory reliability; evaluation-data provenance and privacy.

## Goals

- Trace each reviewed confirmation from its UI through its specialized alias store and, where supported, the shared AI correction store.
- Keep confirmed deterministic imports and matches successful if an advisory-memory write fails, while making that failure visible.
- Prevent spec alias kinds from being filed under the wrong correction domain.
- Document which checked-in evaluation evidence has verified outcomes, what those outcomes measure, and what is missing for provider comparison or model training.
- Add no workbook rows, prompts, AI outputs, operational records, or correction values to logs or documentation.

## Design

Shared correction writes will check both the HTTP response and network failures. A failure will produce a warning toast and a client diagnostic containing only a bounded failure category, HTTP status when available, and capped correction count. Server error logs will use safe metadata rather than raw database errors or bound parameters. The save remains best-effort and resolves without rejecting the import or match. Tests will cover non-2xx responses, network rejection, empty input, and that diagnostics and notices contain no correction values.

Spec aliases will be mirrored to shared corrections only through explicit mappings: brand and flavor to their matching domains; `appType`, `pepType`, and `recipeName` to item; the three ingredient kinds to ingredient; and `dieType` to die. `crossFamilyRouting` remains in its specialized store because it represents a routing choice, not a name correction. Unknown future kinds must not default to ingredient. A focused mapping test will lock this boundary.

The final audit document will map reviewed routes and write boundaries, including manager-only shared-memory authorization. It will describe the deterministic 51-workbook corpus as parser regression evidence, not model gold labels, and the separate 304-case reviewer benchmark as discrepancy-detection evidence, not extraction-provider evidence. It will state provenance/version, privacy, and independent verification requirements for any future gold evaluation set. Unverified role overlap between `manage-profiles` and `manage-staff` will be reported for owner confirmation, not changed here.

## Verification

Run focused correction and alias tests, the deterministic corpus harness, and the relevant typecheck. Inspect generated logs and diffs for workbook, prompt, correction, or operational data. No benchmark, provider comparison, training run, permission broadening, or data heal is included.