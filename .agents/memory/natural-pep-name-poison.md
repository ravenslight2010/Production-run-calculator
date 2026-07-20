---
name: Bare-qualifier pep type names
description: AI parse reduced "Pepperoni Stick - NATURAL (Hormel - 24878)" to bare "NATURAL"; canonical name + three-layer defense.
---

**Rule:** A pep type is always the full product name; qualifiers (NATURAL/CURED) stay attached, vendor/item-code parentheticals are stripped. Canonical natural-stick name is `"Pepperoni Stick - NATURAL"` — already established in the web app's `PEP_TYPE_RENAMES`, so reuse it, never invent a new spelling (e.g. "Natural Pepperoni Stick").

**Why:** The Lowe's spec workbook writes stick rows as "Pepperoni Stick - NATURAL (Hormel - 24878)"; the AI parse emitted just "NATURAL"/"Natural" as the pep type, which spread into brand profiles, saved parses, and the synced pep-type name list ("all Lowe's runs say natural" user report).

**How to apply (three-layer defense for synced-name poison):**
1. Prompt rule + lockstep prompt test + SPEC_PARSE_VERSION bump (fences stale saved parses).
2. One-time server heal (profiles w/ LWW bump, saved sheets, today+future day-state) — backfill only.
3. **Durable write-time guard in the sync PUT path** (canonicalize inside `upsertProtected` after `protectRunValues`) — a stale pre-fix client can re-push the poison forever otherwise; the one-time heal alone is not enough. Client-side rename-on-read (`PEP_TYPE_RENAMES` + `normalizePepFields`, which covers all four pep slots incl. B) heals local lists without a marker bump because renames run at every list read/collect.

Matching must be anchored (`/^natural(\s*\(.*\))?$/i`) so real products like "Natural Bacon" are never touched.
