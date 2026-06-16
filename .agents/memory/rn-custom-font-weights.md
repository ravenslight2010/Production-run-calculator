---
name: RN custom fonts ignore fontWeight
description: In React Native/Expo, fontWeight does not select a weight for a loaded custom font family — you must set fontFamily to the pre-loaded weighted variant.
---

# React Native custom fonts ignore `fontWeight`

When a custom font (e.g. Inter, Space Mono) is loaded via `@expo-google-fonts`,
each weight is a SEPARATE family (`Inter_400Regular`, `Inter_600SemiBold`, ...).
Setting `fontWeight: "600"` on a `Text` styled with a custom family does NOT pick
the semibold variant — RN renders the loaded family as-is. You must set
`fontFamily` to the matching weighted variant.

**Why:** A restyle that paired only `fontWeight` with custom fonts silently rendered
the wrong weight; architect review failed the task on text styles using `fontWeight`
without an explicit `fontFamily`.

**How to apply (run-calculator-mobile):**
- Use `constants/fonts.ts` → `FONTS` { regular/medium/semibold/bold = Inter_*, mono/monoBold = SpaceMono_* } and `interFor(weight)`.
- Every text style needs an explicit `fontFamily`. Weight→family map: 300→regular,
  500→medium, 600→semibold, 700/800/bold→bold. Numeric/tabular values → mono/monoBold
  (mirrors web `font-mono`). Never rely on `fontWeight` alone.
- Audit before finishing: `rg -n "fontWeight" artifacts/run-calculator-mobile/app artifacts/run-calculator-mobile/components`
  and confirm each style object also sets `fontFamily` (it may be on an adjacent line).
- Easy-to-miss files outside screen scope: `app/(tabs)/_layout.tsx` (nav + menu sheet),
  `app/schedule.tsx`, `app/master-data.tsx`, `app/+not-found.tsx`, `components/ErrorFallback.tsx`.
