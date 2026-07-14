---
name: Cheese blend across applicators on spec import
description: Durable gotchas for getting a spec-imported cheese blend onto the right applicator slot(s), incl. TWO-cheese products (Meat Lover).
---

# Spec-imported cheese blends → correct applicator slot(s)

The run form renders its pick-only **Cheese card** ONLY when an applicator's
`app{n}Type` is the literal string `"cheese"` (exact match — see the CheesePickCard
gate in web `home.tsx`). A blend NAME in the type ("Aldo's Cheese Mix") never opens
the card. A product can run TWO+ cheese applicators (same or different blend) at
different per-pizza weights — weight lives on the applicator, not the recipe.

## The trap that bit twice

The AI parse names a cheese applicator by its BLEND, not `"cheese"`, and the parsed
recipe's `app` field is `undefined`. Symptoms: App 2 stays blank (card never
renders) and the recipe-tie fallback `slot = r.app ?? 1` dumps every blend onto
slot 1 (wrong weight on App 1, nothing on App 4).

**A `mirrorSingleCheeseAcrossApplicators` fix was DEAD CODE for this** — it only
fills slots already typed `"cheese"`, which the import never produced. You must
first RE-TYPE the matched slots to `"cheese"` before any mirroring can help.

## Durable invariants (keep web+mobile identical)

- Slot re-typing is done by `resolveCheeseApplicatorSlots(applicators,
  candidateCheeseNames)` in `lib/spec-import`, matching applicator type → candidate
  blend via the shared loose key (`specImportNameMatchKey(cleanSpecCheeseRecipeName)`).
  It returns `links[{slot, recipeName}]` so a two-cheese product fills BOTH slots.
- **Never guard the resolver with a `type.includes("mix")` substring** — a cheese
  blend is legitimately named "…Cheese **Mix**". Mix exclusion is the CALLER's job:
  build candidates from `kind==="cheese" && !specImportRecipeIsMix(...)`. That
  classifier treats a name containing BOTH "mix" and "cheese" as cheese, so real
  cheese blends survive the filter and true topping-mixes (e.g. "White Fajita Mix")
  are kept out.
- The recipe-tie loop must place a blend's rows on EVERY cheese slot whose name
  matches (or is blank), falling back to `r.app`/slot-1 only when the profile has NO
  cheese applicator at all.
- **Candidate names must include the EXISTING pool, not just this import's
  recipes** (user report 2026-07-14: "cheeses in applicator type and not under
  cheese"). A spec-only workbook names a blend the factory already has, with no
  cheese recipe in the same file; without the pool union the resolver found no
  candidate, the raw blend name stayed as the applicator type and leaked into
  the shared Type dropdown. `applySpecImport` now unions
  `loadCheeseRecipePresets()` keys (local mirror of the server pool) into the
  cheese candidates — but MUST filter out Mix names first (mixes share the
  cheese preset map; only the name lists differ) or mix slots get re-typed
  "cheese" before the mix resolver runs. Mix candidates union the Mix name list
  the same way. Backstop: `applyPoolAwareSlotHealIfNeeded` is now RECURRING
  (marker removed) — it re-heals profiles/runs and sweeps leaked pool names out
  of ingredientTypes every boot once pools load; idempotent, writes only on
  change.
- **AI blend naming is nondeterministic** ("… 1.75", "… (S & P)"). The prompt's
  EMBEDDED BLENDS rule now states: blend name = BASE only (no weight/number/flavor
  suffix), and one blend = one recipe even at different oz. `cleanSpecCheeseRecipeName`
  strips any leaked suffix so matching still works if the model drifts.
