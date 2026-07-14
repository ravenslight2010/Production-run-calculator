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
- Live/scheduled RUN VALUES were intentionally NOT rewritten by v1 — run-form
  gates match raw mix names case-insensitively, so old open runs kept working.
- v2 pool-aware heal (`applyPoolAwareSlotHealIfNeeded`, marker
  `run-calc-mix-slot-recat-v2`): the v1 word heuristic missed TYPE slots holding
  exact server pool names without the word "mix" (e.g. "...Cheese Blend"), and
  v1 skipped run values (the Type dropdown unions current values, so strays kept
  showing). v2 must run AFTER the server cheese/mix pools load — skip WITHOUT
  setting the marker while pools are empty — heals profiles (targeted write +
  markProfileEdited) AND run values, and MONOTONICALLY bumps runValuesUpdated
  stamps (never move a stamp backwards) before refresh + push.
- "Phantom" link names (referenced only in local runs/profiles, in no server
  pool) show in the applicator picker (it always includes the current pick) but
  were unfindable elsewhere; the Cheese merge tab must union
  `collectStaleCheeseLinkNames` over the merge surfaces so users can merge them
  away — applyRecipeNameMerge already rewrites every link field.
