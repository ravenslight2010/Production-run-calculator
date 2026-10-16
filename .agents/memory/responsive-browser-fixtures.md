---
name: Responsive browser fixture boundaries
description: Durable browser-test rules for preview chrome, modal identity, and input modality across responsive viewport projects.
---

Responsive layout fixtures must distinguish application geometry from Replit preview chrome, target the intended modal explicitly, and match the configured browser input modality. For primary Run actions on touch-sized layouts, verify rendered hit areas are at least 44×44 CSS pixels and remain in the viewport; CSS utility classes alone do not prove the target size.

**Why:** Fixed preview wrappers can look like app overlays, generic dialog selectors can bind to a still-mounted parent dialog, and desktop Chromium does not support Playwright touch APIs unless the project enables touch. Factory-floor controls must be practical to tap, not only visible.

**How to apply:** Exclude preview-banner descendants from overlap assertions, open or identify the exact dialog under test, use click for desktop projects unless a touch-enabled context is intentional, and assert measured width/height plus viewport bounds in phone/tablet projects without changing gesture or selection semantics.