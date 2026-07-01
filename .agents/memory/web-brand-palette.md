---
name: Web brand palette unification
description: How the web app enforces one brand-amber palette; why orange == amber; where the theme-color lives
---

The web app (`artifacts/run-calculator`) is standardized on a single brand-amber
palette. Brand amber = `#FF9500` = `hsl(35 100% 50%)`, also the `--primary` token.

**Rule:** Tailwind v4 (CSS config). In `src/index.css` the `@theme` block overrides
BOTH `--color-amber-*` and `--color-orange-*` (shades 50–950) to ONE identical
brand-anchored ramp with `500` = `#FF9500`. So every existing `amber-*` and
`orange-*` utility across the ~20 files renders the same brand ramp — `orange-*`
deliberately collapses onto `amber-*`.

**Why:** User asked for one consistent color scheme app-wide. Editing ~200 class
usages by hand was fragile; remapping the two scales in one place unifies the hue
while preserving the design's light-text-on-dark-panel tonal hierarchy
(dark `amber-950` panels stay dark, light `amber-50..300` stay light).

**How to apply:**
- Don't reintroduce a visually distinct `orange` — it will render as brand amber by
  design. For new accents use `amber-*` or the `primary` token; they match.
- The browser/PWA brand color `#FF9500` lives in THREE spots that must stay in sync:
  `index.html` `theme-color` meta, `vite.config.ts` PWA manifest `theme_color`, and
  `public/favicon.svg` fill. The old off-brand value was `#FF3C00`.
- Auth/landing cards echo the app's signature card: `overflow-hidden rounded-2xl
  border border-border/50 bg-card/50 shadow-md` with a top accent stripe
  `<div className="h-1 w-full bg-amber-500/70" />`.
