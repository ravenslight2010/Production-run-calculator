---
name: Import review dialog layers
description: Keep imported spec, premix, and cheese review controls interactive when launched from home or settings.
---

File-review dialogs launched from the home/settings workflows must render above those shell overlays. Keep the spec, premix, and cheese review layers consistent, and verify opt-in and Apply with real browser clicks rather than forced clicks or direct state changes.

**Why:** The review controls could be visible while a lower-z-index dialog left the home/settings overlay above them in the pointer stack. Unit-level visibility checks did not catch the blocked click.

**How to apply:** When changing these dialogs or their entry points, test the real review interaction from the home/settings shell, including checking the opt-in and applying the import.
