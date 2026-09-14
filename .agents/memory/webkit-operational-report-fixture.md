---
name: WebKit operational-report fixture
description: Keep the WebKit authoritative-report smoke test aligned with server-owned canonical data.
---

The WebKit report-preview case must seed a valid live `daily_sync` snapshot after browser hydration, clear same-day completion history, and prevent later sync writes from replacing that fixture. The operational report API intentionally ignores browser-supplied compatibility runs and rejects missing or ambiguous canonical facts.

**Why:** A browser can create or overwrite the day row while the report panel is opening, and historical completion rows are another canonical input. Without isolating both sources, the preview test can fail with a legitimate `canonical-snapshot-invalid` response even though the API is healthy.

**How to apply:** When changing this smoke case or the operational-report contract, keep the fixture in the disposable database, preserve the API's 409 behavior for absent/invalid snapshots, and verify through both the run-specific operational view and the authoritative report preview.