---
name: CSV spreadsheet safety
description: Protect free-text CSV exports from spreadsheet formula injection.
---

Every free-text CSV value must receive formula-injection protection before CSV quoting, including dedicated columns added beside a JSON payload. Treat values beginning with optional whitespace followed by `=`, `+`, `-`, or `@` as potentially executable and prefix them safely without changing normal quoted-field escaping.

**Why:** A structured source-reference column was initially emitted outside the JSON payload and bypassed the export's prior handling assumptions. Bounded manager-entered text can still be opened in spreadsheet software.

**How to apply:** Reuse the shared CSV-cell sanitizer for all CSV columns and cover formula prefixes, quotes, commas, Unicode, and embedded newlines in export tests.
