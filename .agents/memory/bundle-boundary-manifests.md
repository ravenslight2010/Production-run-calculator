---
name: Bundle boundary manifests
description: How to make build-time dependency boundary checks cover modules folded into facade chunks.
---

Build dependency guards must inspect Rollup's per-chunk `modules` membership, not only Vite's standard manifest entries and static chunk imports.

**Why:** Vite's standard manifest can represent a route facade as a synthetic key and omit every source module bundled inside that chunk. A forbidden eager dependency can therefore be folded into Home without appearing as its own manifest entry or static import.

**How to apply:** Emit a build-only manifest from `generateBundle` containing each chunk's module IDs and imports. Start traversal from both the app entry and any route facade being protected, then test every module in the resulting static graph while allowing intentional dynamic chunks.