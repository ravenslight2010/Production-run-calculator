---
name: Operational dialog viewport safety
description: Dynamic viewport and scroll behavior needed for Home-owned operational dialogs on short landscape screens
---

Home-owned operational overlays must cover the dynamic viewport and let their card content scroll before lower-edge hit testing. On short landscape screens, a fixed inset-0 overlay can stop at the layout viewport’s scrollbar boundary, leaving fixed navigation exposed; descendants of a scrollable card can also report visible rectangles while their lower edge is clipped.

**Why:** Short landscape browser layouts combine a reduced dynamic viewport, page scrollbars, and fixed station navigation. Testing only the initial rectangle can either miss a clipped action or report the navigation as the hit target.

**How to apply:** Use a dynamic viewport-height overlay for these dialogs, cap and scroll the dialog card, and scroll each candidate control into view before probing its lower edge. Keep the hit-test negative case after the overlay closes.