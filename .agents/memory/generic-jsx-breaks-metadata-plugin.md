---
name: Generic JSX components break the Replit metadata Babel plugin
description: Why <Comp<T> .../> typechecks but crashes the Vite dev build, and how to pin the type without JSX generics.
---

Generic JSX component syntax — `<FilterRow<StatusFilter> ... />` — passes `tsc`
but CRASHES the Vite dev build (`vite:react-babel`) with a parse error like
`Unexpected token`. The Replit metadata Babel plugin injects
`data-replit-metadata=... data-component-name=...` attributes into the opening
tag, which collides with the `<T>` type argument and produces invalid output
(`<FilterRow data-...="..."<StatusFilter>`).

**Why:** the metadata plugin doesn't understand TS generic type arguments on JSX
elements; tsc and the dev transform disagree, so a typecheck-clean file still
white-screens the app behind a Vite error overlay.

**How to apply:** never use `<Component<T> .../>` in this repo's web artifacts.
Drop the explicit type argument and let it infer. If inference widens wrongly
(e.g. a `useState` setter's `Dispatch<SetStateAction<T>>` makes inference pick
`string`), pin it via the props instead: cast `options={[...] as [T, string][]}`
AND wrap the setter `onChange={(v: T) => setX(v)}` so every inference site agrees
on the union.
