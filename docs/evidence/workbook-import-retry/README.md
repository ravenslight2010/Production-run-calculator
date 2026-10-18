# Workbook provider-retry evidence

This is the sanitized shared handoff for the isolated, review-only retry audit.
Local originals remain at `.local/evidence/workbook-import-audit/`; this directory
preserves the corresponding JSON/Markdown receipts because managed commits exclude
local agent metadata. When a local original is unavailable, use the same filename
here. Historical browser images and broader browser-run artifacts are not copied.

All 25 originally failed SHA-256 contents were processed across 28 chunks with
HTTP 200. Twelve results require normal parsed-result review and thirteen have
conservative unit/name/warning flags. These flags are not confirmed defects.
No Apply was called, and all 24 canonical table snapshots were unchanged.

The receipts preserve initial failures, previous attempts, final outcomes, source
hashes, safe status/model summaries, pacing and scoped authorization checks.
They contain neither newly generated recipes nor raw provider response bodies or
credentials. Provider usage not reported by the gateway is unknown, not zero cost.

The API adapter repair was verified with 22 focused tests, an integration-library
typecheck, an API build, and the bounded real-provider batch. The related dark-mode
warning text was checked by source and contrast calculation. No full release rerun,
production-database recovery, automatic data repair, or production GO is claimed.
