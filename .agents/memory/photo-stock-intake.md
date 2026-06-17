---
name: Photo stock intake
description: Durable decisions for the AI photo→restock intake feature (server, web, mobile).
---

# Photo stock intake

AI vision identifies incoming stock from a photo; the user confirms each row; commits
flow through the EXISTING restock path. Durable decisions a future agent can't infer:

- **No second write path.** The identify endpoint is READ-ONLY (identify, never write).
  All commits must go through the normal restock path — never add a parallel inventory writer.
- **Always require per-row confirmation** before committing, even on high confidence. The AI
  is treated as untrusted: validate its JSON with Zod, drop invalid items, clamp confidence,
  and scrub any matched key the client didn't actually offer as a candidate.
- **What the user sees == what is committed.** When a row is matched to an existing item,
  lock its name/unit/category to that candidate (read-only) and commit those locked values.
  Editable fields only when creating a new item. Never commit values that differ from the UI.
  **Why:** a prior review rejected silently committing matched values while showing editable fields.
- **Uncertain-match UX is required, at strict web+mobile parity.** Each review row must let the
  user re-pick the target ("new item" + existing candidates ranked by name closeness). The set of
  selectable options must be IDENTICAL across web and mobile — do not cap one platform's list,
  even for layout reasons (a prior review rejected a mobile-only top-N cap as a parity break).

**Why parity:** replit.md mandates identical behavior across web+mobile; UI/storage adapt per
platform but the feature set and selectable choices must match.

## Known follow-ups (intentional, not done)
- The vision endpoint is unauthenticated/unthrottled like the rest of the API. If auth or
  rate-limiting is ever added, gate this expensive route too (cost/DoS surface).
