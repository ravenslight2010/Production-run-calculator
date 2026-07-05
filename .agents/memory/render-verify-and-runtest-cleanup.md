---
name: Rendered verification & runTest cleanup
description: How to reliably verify a rendered web/mobile UI branch in this repo when runTest is flaky, plus a cleanup gotcha after runTest timeouts.
---

# Rendered verification when runTest is unreliable

**runTest is flaky in the isolated env** (documented in runtest-expo-web-quirks.md
and headless-e2e-fallback.md). It regularly hits the 600s code-execution cap and
never returns.

## Web: render the real component under vitest + jsdom
The web artifact (`artifacts/run-calculator`) already has
`@testing-library/react` + `jsdom` wired in `vitest.config.ts` (environment
jsdom, `fileParallelism:false`). Even a component defined inside the giant
`src/pages/home.tsx` (100+ imports) **can be imported and mounted** in a
`@vitest-environment jsdom` test — the whole app module evaluates fine at import
time (no top-level `import.meta.env` land mines). So for a presentational branch
whose component is exported (e.g. `CheesePickCard`), prefer a real RTL render
test over a browser e2e — it's deterministic and proves the actual JSX, catching
inverted conditions / branches hidden behind another branch.

**How to apply:** run a single file from bash with
`pnpm exec vitest run src/<file>.test.tsx` (single-file from bash is fine; the
full suite from bash can starve — see the parity/test gotchas).

## Mobile: parity-lock instead of render
Mobile (`artifacts/run-calculator-mobile`) has **no unit-test harness** (typecheck
only) and much of its UI is inline in huge screen files (e.g.
`app/(tabs)/configure.tsx`), so it is not importable/renderable in isolation. The
established pattern (see `src/cheesePick.parity.test.ts`) is a **source-drift /
parity guard**: read both source files and assert the mobile block matches web
after normalization (predicate, user-facing copy, and that the branch renders in
the same place, not inverted). Combine that with the web real-render test so the
web render's guarantee transfers to mobile.

**Why:** isolated component rendering is impractical on both sides (web = mega
-module, mobile = inline + no harness); this two-pronged approach is reliable and
matches how the repo already handles non-importable inline logic.

# Cleanup gotcha: runTest can create data even when it times out
A `runTest` call that hits the 600s cap can still have **driven the app far
enough to sign up a user** (and could create other rows) before timing out.
After any runTest timeout, check for and clean stray rows — e.g. a signup user in
`users` (+ its `user_roles`) — not just the fixtures you inserted yourself.
