---
name: Responsive browser fixture boundaries
description: Durable browser-test rules for preview chrome, modal identity, and input modality across responsive viewport projects.
---

Responsive layout fixtures must distinguish application geometry from Replit preview chrome, target the intended modal explicitly, and match the configured browser input modality. For primary Run actions on touch-sized layouts, verify rendered hit areas are at least 44×44 CSS pixels and remain in the viewport; CSS utility classes alone do not prove the target size.

**Why:** Fixed preview wrappers can look like app overlays, generic dialog selectors can bind to a still-mounted parent dialog, and desktop Chromium does not support Playwright touch APIs unless the project enables touch. Factory-floor controls must be practical to tap, not only visible.

**How to apply:** Exclude preview-banner descendants from overlap assertions, open or identify the exact dialog under test, use click for desktop projects unless a touch-enabled context is intentional, and assert measured width/height plus viewport bounds in phone/tablet projects without changing gesture or selection semantics.

For no-document-scroll checks on dialogs, bring the trigger into view before recording the scroll baseline; Playwright may scroll the page as part of `tap()` when the trigger itself is off-screen.

**Why:** A setup form may need to scroll to reveal a lower trigger. Comparing against the pre-tap position can mistake this automation scroll for a dialog-induced jump.

**How to apply:** Call `scrollIntoViewIfNeeded()` on the trigger, record `window.scrollY`, then tap and compare the page position while the dialog is open and after it closes.

Scope incident assertions to a stable incident identity before checking its guidance text; separate records can legitimately share the same explanation.

**Why:** Page-wide text assertions became ambiguous on responsive incident lists even though each individual card was correct.

**How to apply:** Locate the incident card by its bounded correlation reference, then assert within that card rather than relying on globally unique prose.

WPE can project network-console messages as `pageerror`, splitting the URL's first colon between the error name and message. Do not equate that format with an uncaught application exception, or broadly ignore access-control messages.

**Why:** Explicit reloads produced this browser-specific format while the application continued to render; recording phase names alone hid the distinction.

**How to apply:** Retain bounded network diagnostics separately, recognize only exact expected same-origin routes during deliberate navigation, and require successful fresh reads afterward. Unexpected routes, normal-operation failures, and actual JavaScript exceptions must still fail.