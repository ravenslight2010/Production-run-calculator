---
name: LiveRunContext clock isolation
description: How the 1-second clock was isolated from Home so non-live tabs don't re-render every second.
---

# LiveRunContext clock isolation

## The rule
`Home` must NOT call `useClock`, `useAutoTrack`, `useNotifications`, or run stall/calc logic. All of that lives in `LiveRunProvider`. Clock-dependent UI goes in the 11 extracted sub-components at the bottom of `home.tsx`.

**Why:** When Home holds `nowTime` (a `Date` ticking every second), the entire component tree re-renders each second — including expensive tabs like Setup, Inventory, and Manage that don't need live data.

## How to apply
- `LiveRunContext.tsx` exports: `useLiveRun()`, `LiveRunProvider`, `calcRef` (module-level, sync'd each render so Home callbacks can read `calc` without subscribing).
- `Home` creates `HomeCtx` (657 stable vars) and `LiveRunProvider` wraps the JSX.
- The 11 sub-components are appended at the end of `home.tsx` and call `useHomeCtx()` + (where needed) `useLiveRun()`.
- `autoSuppressUntilRef = useRef<number>(0)` is declared in Home (early, before first use) and passed as `externalAutoSuppressRef` to both LiveRunProvider AND `useAutoTrack` — the hook must receive it directly so its own suppression check (Date.now() < ref.current) reads the shared ref, not its internal copy. Failing to wire this causes auto-track to clobber manual edits during the suppression window.
- `stallCheck` is exported from `useLiveRun()` so ScreenModeView can render stall UI.
- `saveRunValues` in LiveRunContext.tsx (next-run dough pre-seed) is stamped with `markRunValuesUpdated` — add `contexts/LiveRunContext.tsx` to the allowlist in `runValueStampGuard.test.ts`.

## Auto-discovery gotchas (transform_home.py)
- Must scan multiline object AND array destructurings (`[a, b] = useState(...)`) at 2-space indent.
- Must match `async function name` in addition to `function name` and `const name`.
- CLOCK_VARS excludes vars deleted from Home: `stallCheck`, `stallEpisodeShownRef`, `nextRunSeededRef` must be in CLOCK_VARS even though they aren't clock values per se.
- `fix_lambda_any` needs `\s*` after `\(` to catch multiline callbacks and a general `\w+\(\s*word =>` pattern for state-setter updaters.
- `suggestedDoughStaging` is imported separately from `../hooks/useAutoTrack` — keep that import even though the hook import itself is removed.
