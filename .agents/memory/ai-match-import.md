---
name: AI Excel-import brand/flavor matching
description: How the AI-assisted Excel import matcher is structured and its trust/parity invariants
---

# AI Excel-import matching

The Excel schedule import can ask the AI to match imported brand/flavor names
that did not exactly match a saved one. It is an *assist on top of* the existing
Levenshtein fuzzy chips, never a replacement.

## Invariants (don't break these)
- **Endpoint is manager-gated.** `/ai/match-import` uses `requireRole("manager")`.
  Operators get 403. Therefore the clients MUST treat the call as best-effort and
  silently fall back to fuzzy matching on ANY error — never surface the failure or
  block the import. (Same posture as the photo/optimize/fill-missing endpoints.)
- **Server sanitizes AI output as untrusted.** The route drops any match whose
  candidate wasn't in the request and any match value that doesn't canonicalize
  (case-insensitive) to a real saved brand / a real saved flavor *of that brand*.
  Clients can therefore apply returned matches directly without re-checking.
- **Never clobber the user.** AI matches auto-apply only to choices still at SKIP.
  A per-candidate ref guard (requested brand/flavor key sets) stops the
  brand→flavor cascade from refetching the same names as brands resolve.
- **Web+mobile parity.** Dialog (`ExcelImportDialog.tsx`) and modal
  (`ExcelImportModal.tsx`) mirror the same state/effects/chip behavior; the AI
  suggestion is merged into the fuzzy chip list (dedup, AI first) and tinted.

**Why:** AI output is the classic confused-deputy risk — a hallucinated "match"
could silently remap a real production run to the wrong product. The known-list
canonicalization on the server is the trust boundary; the SKIP-only auto-apply is
the safety net for user intent.
