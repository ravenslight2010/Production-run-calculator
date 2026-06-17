---
name: Photo stock intake
description: How the AI photo→restock intake feature is wired across server, web, and mobile.
---

# Photo stock intake

Adds incoming stock from a photo: AI vision identifies items+qty, user confirms each
row, then commits through the EXISTING restock path. No second inventory write path.

## Flow / contract
- Server route `POST /inventory/identify-photo` is READ-ONLY: it only identifies, never writes inventory.
- It returns `{ items: PhotoGuess[] }` (name, qty, unit, category, matchedKey, confidence).
- Clients build editable review rows from guesses, require per-row confirmation, then call
  the normal `restockInventory` (`POST /inventory/restock`). The intake never bypasses restock.

## Matching
- Both clients send a merged candidate set = tracked inventory items + production-derived
  `deriveCandidateItems` candidates, deduped by `key`.
- Server `sanitizeGuesses()` nulls any `matchedKey` not present in the supplied candidates and
  clamps confidence to [0,1]; trust the server to scrub, but clients also re-resolve matchedKey.
- Key derivation on confirm: matched → use candidate's key/category/name/unit; new → `${category}:${name}:${unit}`.

## Platform specifics
- Web: downscales via canvas (`fileToBase64Jpeg`, maxEdge 1280, q0.6); `<input capture="environment">`.
- Mobile: `expo-image-picker` `launchCameraAsync`/`launchImageLibraryAsync` with `{ base64: true, quality: 0.5 }`
  (no canvas — base64 comes straight from the picker). Camera needs runtime permission;
  app.json declares the `expo-image-picker` plugin for native permission strings.

**Why:** parity rule (replit.md) — behavior identical across web+mobile, storage/UI adapted per platform.

## Known follow-ups (not done, intentional)
- The AI endpoint is unauthenticated/unthrottled, matching the rest of the API. If auth/rate-limiting
  is ever added to the API, gate this expensive vision route too (cost/DoS surface).
