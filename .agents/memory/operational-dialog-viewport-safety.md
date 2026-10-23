---
name: Operational dialog viewport safety
description: Dynamic viewport and scroll behavior needed for Home-owned operational dialogs on short landscape screens
---

Home-owned operational overlays must cover the dynamic viewport and let their card content scroll before lower-edge hit testing. On short landscape screens, a fixed inset-0 overlay can stop at the layout viewport’s scrollbar boundary, leaving fixed navigation exposed; descendants of a scrollable card can also report visible rectangles while their lower edge is clipped.

Normal-flow app-shell panels can still geometrically intersect fixed bottom navigation when they expand, especially with enlarged text. Bound and internally scroll long panels, and leave extra space for the text-scaled navigation rather than relying on nominal rem sizing alone.

**Why:** Short landscape browser layouts combine a reduced dynamic viewport, page scrollbars, and fixed station navigation. At 150% text sizing, the station tabs grew enough to overlap a normal-flow update panel even though pointer hit-testing still reached the tab.

**How to apply:** Use a dynamic viewport-height overlay for these dialogs, cap and scroll the dialog card, and scroll each candidate control into view before probing its lower edge. For app-shell panels, cap and scroll the panel itself with clearance for the bottom navigation. Test 320-pixel-wide phone layouts, short landscape, enlarged text, both geometric overlap and actual hit targets.

A viewport-sized dialog does not guarantee viewport-sized controls: an automatic
grid track can inherit the minimum width of a long unbroken operation name and
push its footer off-screen.

**Why:** A phone confirmation had an in-viewport card but an action wider than
the screen, even after scrolling it into view.

**How to apply:** Constrain grid tracks and child minimum widths as well as the
card itself. Allow long evidence names and action labels to wrap. Check actual
control bounds after scrolling, not just the outer dialog rectangle.