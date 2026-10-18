---
name: Diagnostic persistence scope
description: Keep architecture checks for diagnostic persistence scoped to diagnostic-writing operations, not every transaction in a mixed-responsibility module.
---

**Rule:** A file-level check must not equate “exports diagnostic types” with “all database transactions persist diagnostics.” Detect direct transactions in diagnostic persistence functions while allowing unrelated domain transactions in the same module.

**Why:** Queue/status diagnostics can live beside job lifecycle code, which legitimately uses transactions for job state. A file-wide assertion creates false positives without making the diagnostic write path safer.

**How to apply:** When changing the shared diagnostic persistence guard, retain a positive case for direct diagnostic persistence and a negative case for an unrelated transaction in a module that exports diagnostics. Keep the shared coordinator as the required path for diagnostic writes.
