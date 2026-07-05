---
name: Stick pep types (pepperoni AND cheese sticks)
description: The spec importer's "stick applicator" pep type covers cheese sticks too, not just pepperoni.
---

The pizza line's stick applicator applies whole "sticks" — pepperoni sticks
AND cheese sticks (e.g. "Cheese Stick", "Mozzarella Stick"). All of these are
profile PEP TYPES, captured on a profile's `pepperonis` list (type + sticks +
oz/pizza), NOT cheese/topping recipes.

**Why:** A spec import ("cornerbooth 5cheese") failed to pull its "cheese stick"
pep type because the importer historically hardcoded only pepperoni as a stick
type in two places, so a cheese stick was treated as a cheese recipe (or
dropped) and never became a pep type.

**How to apply:** Stick recognition lives in TWO shared/server-side spots (fix
both, keeps web+mobile parity automatically):
- AI parse prompt in `artifacts/api-server/src/routes/aiParseSpecSheet.ts`
  ("STICK-APPLIED TOPPINGS ARE NOT A RECIPE" section) — tells the model which
  stick-form toppings go to `pepperonis`.
- Deterministic backstop in `lib/spec-import/src/index.ts`:
  `STICK_PEP_NAME_RE` + `isStickPepOnlyCheeseRecipe` — DROPS a cheese-kind
  recipe whose rows are ALL stick peps (it does NOT synthesize a `pepperonis`
  entry; it relies on the model having emitted one, so if the model omits it the
  stick data is still lost — pre-existing limitation for pepperoni too).
- DICED pepperoni stays the exception (it's a topping, kept as a recipe).

Any NEW stick-form topping type must be added to BOTH the regex and the prompt.
