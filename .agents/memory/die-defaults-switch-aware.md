---
name: Die defaults switch-aware fill
description: Two die line-default resolvers — switch-aware for explicit die picks, strict blank-fill for import/autofill paths.
---

# Die line-default fill has TWO resolvers

- `resolveDieLineDefaults` — strict blank-fill-only (field must equal the untouched form default). Used by paths with NO explicit prior die pick: spec import (storage.ts applySpecImport) and profile autofill (SetupProfileEditor applyAutofillToForm).
- `resolveDieLineDefaultsOnSwitch` — used when the user EXPLICITLY picks a die (run-form die selector, profile-editor die chips). A field is also replaceable when its value equals that field's default from ANY known die (built-in map or manager override) — i.e. it was auto-filled by a previous die pick.

**Why:** blank-fill-only alone meant switching die A→B never applied B's defaults (fields were no longer "blank"). But import paths must stay strict or an import could clobber values that merely coincide with a die default.

**How to apply:** new die pre-fill call sites must choose the right resolver by whether an explicit user die pick precedes the fill. User-typed values matching no die's defaults are never overwritten by either.
