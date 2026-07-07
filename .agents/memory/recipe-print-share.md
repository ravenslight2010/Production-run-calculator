---
name: Recipe print/share buttons
description: Per-recipe-card print/share buttons on web — built 2026-07-07; design decisions and web-only status.
---

Built (web only — parity paused): every recipe card header (cheese editable + pick-only, mix, sauce/frontline, dough) has print + share icon buttons.

**Decisions:**
- Share uses Web Share API when present; AbortError (user closed the sheet) counts as shared and must NOT fall through to the clipboard, or closing the sheet silently overwrites the user's clipboard. No share API → copy to clipboard with a transient "Copied" note.
- Print opens a small escaped-HTML popup and calls print(); popup-blocked returns false and the button shows "Pop-up blocked" instead of failing silently.
- All recipe content is HTML-escaped before interpolation (recipe/ingredient names are user-entered).
- Mix cards pass unit "oz/pizza" even though the row field is named `lbs` — mixes store oz per pizza in that field. Cheese/sauce/dough are "lbs/batch".

**When mobile parity resumes:** this feature exists only on web and will need a mobile equivalent (native Share API; print likely N/A).
