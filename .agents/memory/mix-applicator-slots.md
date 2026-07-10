---
name: Mix applicator slots
description: Applicator TYPE slots use generic "Mix"/"cheese" types; recipe names live in the app{n}CheeseRecipeName link, never as the slot type.
---

# Mix applicator slots are generic-typed

Applicator slots on a profile must hold the GENERIC type the run form's recipe
cards gate on — literal `"Mix"` for mixes, `"cheese"` for cheese blends — with
the actual recipe name stored in `app{n}CheeseRecipeName` (shared field for
both kinds) and rows in `app{n}CheeseRecipe`.

**Why:** older spec imports wrote raw mix names ("White Fajita Mix") straight
into the TYPE slot and the shared Type dropdown, so the run form's Mix/Cheese
cards never activated and stray names polluted the dropdown. Approved fix
2026-07-09: unified on generic types.

**How to apply:**
- Spec import: `resolveMixApplicatorSlots` (lib/spec-import) mirrors the cheese
  resolver — re-types matched slots to `"Mix"`, returns slot→name links; the
  tie loop only fills slots typed exactly "mix" whose link matches or is blank.
- One-time migration `applyMixSlotRecategorizeIfNeeded`
  (`run-calc-mix-slot-recat-v1`) healed old profiles: targeted PROFILE_KEY
  localStorage write (NOT saveProfile — it would clobber the crust blob with an
  empty extract), tombstoned strays out of ingredientTypes, ensured generic
  "Cheese"/"Mix" dropdown entries (clearDeleted so the additive sync union
  keeps them), and queued converted mixes in a pending-server-push localStorage
  queue that home.tsx retries on boot until a manager session succeeds.
- "mix"/"cheese" must be allowlisted in every stray-mix-name filter or the
  generic types themselves get flagged as strays.
- Live/scheduled RUN VALUES were intentionally NOT rewritten — run-form gates
  match raw mix names case-insensitively, so old open runs keep working.
