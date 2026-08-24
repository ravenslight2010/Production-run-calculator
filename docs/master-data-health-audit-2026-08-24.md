# Master-data health audit — 2026-08-24

## Scope and evidence

This audit owns the pre-existing development scan recorded on 2026-08-23
(89 findings: 83 errors and 6 warnings) and compares it with a fresh scan of
the current development database. Queries used only grouped counts, stable
pool/profile identifiers, and the affected field; no full profile documents or
request data were exported.

The published production snapshot was also queried read-only. It is not a
like-for-like baseline: it contains an older schema/data state and its latest
stored scan reported 317 findings (43 errors, 274 warnings), predominantly
duplicate ingredient names. Production was not mutated and cannot be declared
verified against the corrected detector until the next publish runs the current
code.

## Disposition

| Original finding pattern | Classification | Owner/action |
| --- | --- | --- |
| Empty enabled sauce rows | Valid data | Master-data owner; these are documented buy-as-is sauces and remain unchanged. |
| Cheese rows with zero batch pounds and positive share percentages | Valid data | Master-data owner; regular spec imports store blend ratios in `sharePct` and intentionally keep batch pounds at zero. |
| Repeated duplicate-name warnings for one ingredient/recipe name | Detector defect | Master-data owner; report now emits one stable finding per duplicate-name group. No rows were merged or deleted. |
| Profile links to names absent from the current recipe pool | Stale data / import review | Import-review owner; preserve manager values and resolve only from a confirmed source or explicit manager action. |
| Enabled recipes with neither formula nor documented valid representation | Integrity defect requiring review | Master-data owner; no automatic replacement is safe without source evidence. |
| Duplicate ingredient-name groups | Integrity defect requiring review | Master-data owner; IDs, categories, and references must be reconciled before any merge. |

## Results

The fresh development report, built at `2026-08-24T00:00:00.000Z`, contains:

- 62 findings total: 13 errors and 49 warnings.
- 5 stale/import-review profile-link findings.
- 57 master-data review findings.
- 0 safe automatic repairs selected.
- Valid buy-as-is and ratio-based rows are no longer reported as errors.
- Duplicate-name warnings are grouped by normalized name, avoiding repeated
  findings with the same stable ID.

The five retained profile links now have bounded, source-backed repair
proposals. Aldo's Sausage resolves `Aldo's Sauce (made in house)` to the
saved-import recipe `Aldo's Sauce`. The four Basha's Ultra Thin Crust profiles
(5 Cheese, BBQ Chicken, Hawaiian, and Ultimate Pepperoni) resolve
`11" CRB recipe` to the current `CRB Dough` pool row through the confirmed CRB
recipe-name alias. These proposals update only the recipe-name field, require
an explicit manager-selected finding ID, and skip the update if the profile's
stored value changed since the scan. No replacement is guessed and no started
run snapshot is rewritten by this path.

The scan is intentionally review-first. No manager-entered profile values,
recipe formulas, ingredient rows, aliases, or deleted records were changed by
this audit. Existing boot heals remain marker-guarded and were not broadened.

## Duplicate ingredient reconciliation decisions

The 49 `ingredients:duplicate:*` warnings were reviewed against the current
`ingredients` catalog and every name-based component reference in the dough,
sauce, cheese, and mix pools. `refs` below is the number and category of
referencing recipe components; `none` means no current recipe reference. The
catalog has no per-row manager/creator field, so manager ownership is recorded
as **master-data owner** for every group. The older row is the established
catalog entry; the row created during the 2026-08-24 import/bootstrap wave is
the newer duplicate.

| # | Normalized ingredient name | Established row → newer duplicate | Categories on duplicate rows | References | Decision |
|---:|---|---|---|---|---|
| 1 | 5 Cheese Spice Blend | `ing-1786795974936-vfgieo` → `ing-1787543786942-oa9ma1` | cheese / cheese | cheese (1) | **MERGE newer into established; keep `...-vfgieo`.** |
| 2 | ADM WHEAT FLOUR | `ing-1787446329255-mn5wau` → `ing-1787543786942-4d8ycd` | dough / dough | dough (1) | **MERGE newer into established; keep `...-mn5wau`.** |
| 3 | Bacon (Tri Meats TM3514U or C&F 061ANUB40) | `ing-1786795974435-bsm925` → `ing-1787543786942-msd4ey` | mix / general, cheese | mix (2) | **MERGE newer into established; keep `...-bsm925`; union categories if needed.** |
| 4 | Black Pepper | `ing-1787410683669-vn7npo` → `ing-1787543786942-8onxxe` | frontline / frontline | sauce (1) | **MERGE newer into established; keep `...-vn7npo`; retain frontline category.** |
| 5 | Blanched White Onion Strips | `ing-1786891027192-elkds8` → `ing-1787543786942-5qyob0` | mix / cheese | mix (2) | **MERGE newer into established; keep `...-elkds8`; union mix+cheese categories.** |
| 6 | Blanched Yellow Pepper Strips | `ing-1786891027192-9nv04u` → `ing-1787543786942-v9ehub` | mix / cheese | mix (1) | **MERGE newer into established; keep `...-9nv04u`; union mix+cheese categories.** |
| 7 | C&F - 001MPDC40 or House of Raeford - 28501 | `ing-1786891027192-vdkqc9` → `ing-1787543786942-jy8o28` | mix / cheese | mix (1) | **MERGE newer into established; keep `...-vdkqc9`; union mix+cheese categories.** |
| 8 | Cheese | `ing-1785086670570-jdgxul`, `...-jryv0d`, `...-n6zxmm`, `...-mcnmr9`, `...-j2ump0` | general / general (all 5) | none | **KEEP SEPARATE pending manager ownership decision.** Generic, unreferenced rows do not establish that they are the same material. |
| 9 | Cilantro | `ing-1786795974936-1if2tu` → `ing-1787543786942-o2uzmi` | cheese / cheese | cheese (2) | **MERGE newer into established; keep `...-1if2tu`.** |
| 10 | Cow's Romano | `ing-1786891027851-c1w75o` → `ing-1787543786942-25v0wp` | cheese / cheese | cheese (1) | **MERGE newer into established; keep `...-c1w75o`.** |
| 11 | Diced Pepperoni (Sugardale - 02032) | `ing-1786795974936-owcnui` → `ing-1787543786942-fxdqho` | cheese / cheese | cheese (1) | **MERGE newer into established; keep `...-owcnui`.** |
| 12 | Egg | `ing-1786795974435-z3h6li` → `ing-1787543786942-wssl30` | mix / cheese | mix (1) | **MERGE newer into established; keep `...-z3h6li`; union mix+cheese categories.** |
| 13 | Fontina | `ing-1786891027851-1mhp1e` → `ing-1787543786942-ntmv38` | cheese / cheese | cheese (1) | **MERGE newer into established; keep `...-1mhp1e`.** |
| 14 | FR Green Pepper Strips | `ing-1786795974435-3kmfin` → `ing-1787543786942-5277fx` | mix / cheese | mix (3) | **MERGE newer into established; keep `...-3kmfin`; union mix+cheese categories.** |
| 15 | FR Red Onion Strips | `ing-1786795974435-tmrwui` → `ing-1787543786942-c69qu7` | mix / general, cheese | mix (1) | **MERGE newer into established; keep `...-tmrwui`; retain mix and review general/cheese category metadata.** |
| 16 | FR Red Pepper Strips | `ing-1786795974435-joaakr` → `ing-1787543786942-xev9v9` | mix / cheese | mix (2) | **MERGE newer into established; keep `...-joaakr`; union mix+cheese categories.** |
| 17 | Franks Hot Sauce | `ing-1787410683669-aznla5` → `ing-1787543786942-5gmz2i` | frontline / frontline | sauce (1) | **MERGE newer into established; keep `...-aznla5`.** |
| 18 | FRESH COMPRESSED YEAST | `ing-1787446329255-xsspuc` → `ing-1787543786942-4pp60m` | dough / dough | dough (1) | **MERGE newer into established; keep `...-xsspuc`.** |
| 19 | Fresh Spinach (broken up) | `ing-1786890474475-i7b9d5` → `ing-1787543786942-xkiif7` | mix / cheese | cheese (1), mix (1) | **MERGE newer into established; keep `...-i7b9d5`; union mix+cheese categories.** |
| 20 | Frozen Basil Flakes | `ing-1786795974435-h1q5tj` → `ing-1787543786942-0g8tuf` | mix / cheese, frontline | mix (1), sauce (1) | **MERGE newer into established; keep `...-h1q5tj`; union mix+cheese+frontline categories.** |
| 21 | Galrlic Sauce | `ing-1787410683669-q9akov` → `ing-1787543786942-fdirbd` | frontline / frontline | sauce (1) | **MERGE newer into established; keep `...-q9akov`.** |
| 22 | Garlic Powder | `ing-1786891027192-vkzz48` → `ing-1787543786942-kcy45q` | mix / cheese | dough (1), mix (2) | **MERGE newer into established; keep `...-vkzz48`; union mix+cheese and review dough reference.** |
| 23 | Granulated Garlic | `ing-1787410683669-ryolwb` → `ing-1787543786942-ycmrhm` | frontline / frontline | sauce (1) | **MERGE newer into established; keep `...-ryolwb`.** |
| 24 | Grated Parmesan | `ing-1786795974936-wr47cc` → `ing-1787543786942-1xdos0` | cheese / cheese | cheese (4) | **MERGE newer into established; keep `...-wr47cc`.** |
| 25 | Ground Basil | `ing-1787410683669-mjb2ok` → `ing-1787543786942-b5tiql` | frontline / frontline | sauce (1) | **MERGE newer into established; keep `...-mjb2ok`.** |
| 26 | HONEY | `ing-1787446329255-563lj1` → `ing-1787543786942-t7do0b` | dough / dough | dough (1) | **MERGE newer into established; keep `...-563lj1`.** |
| 27 | Mix | `ing-1785086670570-gvxx7o`, `...-h1evji`, `...-1347tw`, `...-nw7d2h`, `...-3q8e24` | general / general (all 5) | none | **KEEP SEPARATE pending manager ownership decision.** Generic, unreferenced rows do not establish that they are the same material. |
| 28 | Monterey Jack | `ing-1786795974936-lzkvi6` → `ing-1787543786942-9alnvm` | cheese / general, cheese | cheese (2) | **MERGE newer into established; keep `...-lzkvi6`; retain cheese category and review general flag.** |
| 29 | Mushrooms | `ing-1786891027192-lzjtrb` → `ing-1787543786942-foemzl` | mix / cheese | mix (2) | **MERGE newer into established; keep `...-lzjtrb`; union mix+cheese categories.** |
| 30 | Nutmeg | `ing-1786891027851-0r6427` → `ing-1787543786942-g2b99j` | cheese / cheese | cheese (1) | **MERGE newer into established; keep `...-0r6427`.** |
| 31 | Onion Powder | `ing-1787410683669-n7nzl7` → `ing-1787543786942-n5zc3x` | frontline / frontline | sauce (1) | **MERGE newer into established; keep `...-n7nzl7`.** |
| 32 | Oregano Flake | `ing-1786795974936-ustnvu` → `ing-1787543786942-3jmpdq` | cheese / cheese, frontline | cheese (2), sauce (1) | **MERGE newer into established; keep `...-ustnvu`; union cheese+frontline categories.** |
| 33 | Part Skim Mozzarella | `ing-1786795974936-k8kjo9` → `ing-1787543786942-t8tvci` | cheese / cheese | cheese (2) | **MERGE newer into established; keep `...-k8kjo9`.** |
| 34 | Pineapple - Drained | `ing-1786890474475-7qqjih` → `ing-1787543786942-fvnfvg` | mix / general | mix (1) | **MERGE newer into established; keep `...-7qqjih`; retain mix and review general flag.** |
| 35 | Pizella | `ing-1786795974936-uitm46` → `ing-1787543786942-43qwhi` | cheese / cheese | cheese (1) | **MERGE newer into established; keep `...-uitm46`.** |
| 36 | Provolone | `ing-1786795974936-hqqte3` → `ing-1787543786942-ajd5i0` | cheese / cheese | cheese (5) | **MERGE newer into established; keep `...-hqqte3`.** |
| 37 | Red Hot Sauce (Old Vienna) | `ing-1787410683669-a01bn4` → `ing-1787543786942-9qcrt2` | frontline / frontline | sauce (1) | **MERGE newer into established; keep `...-a01bn4`.** |
| 38 | Riplets Seanoning | `ing-1787410683669-5kyra0` → `ing-1787543786942-f2975o` | frontline / frontline | sauce (1) | **MERGE newer into established; keep `...-5kyra0`.** |
| 39 | Salt | `ing-1786795974435-xi9j5z` → `ing-1787543786942-hnpd75` | frontline / dough, frontline | dough (1), sauce (1) | **MERGE newer into established; keep `...-xi9j5z`; union dough+frontline categories.** |
| 40 | Sausage (C&F 001LPIS40) | `ing-1786795974936-kbrxk6` → `ing-1787543786942-45e55s` | cheese / general, cheese | cheese (1) | **MERGE newer into established; keep `...-kbrxk6`; retain cheese and review general flag.** |
| 41 | SHEEP Romano | `ing-1786795974936-xd0atg` → `ing-1787543786942-cd1kn4` | cheese / cheese, frontline | cheese (1), sauce (1) | **MERGE newer into established; keep `...-xd0atg`; union cheese+frontline categories.** |
| 42 | Sugar | `ing-1787410683668-3oz5kb` → `ing-1787543786942-jgj5yu` | frontline / frontline | sauce (2) | **MERGE newer into established; keep `...-3oz5kb`.** |
| 43 | SUNFLOWER OIL | `ing-1787446329255-rx521n` → `ing-1787543786942-tqe1jd` | dough / dough | dough (1) | **MERGE newer into established; keep `...-rx521n`.** |
| 44 | Tomatek Crushed & Concentrate Tomatoes | `ing-1787410683668-kpj8jy` → `ing-1787543786942-8gpo1j` | frontline / frontline | sauce (1) | **MERGE newer into established; keep `...-kpj8jy`.** |
| 45 | Water | `ing-1787410683668-lupmsa` → `ing-1787543786942-gxldhg` | frontline / dough, frontline | dough (1), sauce (1) | **MERGE newer into established; keep `...-lupmsa`; union dough+frontline categories.** |
| 46 | White Cheddar | `ing-1786795974936-7mjap5` → `ing-1787543786942-v7kl9m` | cheese / cheese | cheese (1) | **MERGE newer into established; keep `...-7mjap5`.** |
| 47 | Whole Milk Mozz | `ing-1786795974936-6e7gow` → `ing-1787543786942-qsvtx0` | cheese / cheese | cheese (3) | **MERGE newer into established; keep `...-6e7gow`.** |
| 48 | Whole Mozzarella | `ing-1786795974936-6f4rtz` → `ing-1787543786942-zvo4fs` | cheese / general, cheese | cheese (4) | **MERGE newer into established; keep `...-6f4rtz`; retain cheese and review general flag.** |
| 49 | Yellow Cheddar | `ing-1786795974936-ofdw1y` → `ing-1787543786942-c1xhhc` | cheese / cheese | cheese (3) | **MERGE newer into established; keep `...-ofdw1y`.** |

These are decisions, not repairs: no ingredient rows, recipe component names,
inventory items, learned batch weights, aliases, or deleted records were
changed. Before any future merge, the manager action must preserve the
established ID, union confirmed category metadata, repoint any references to
the kept ID, and soft-disable the source through the manager-gated merge route.
The two generic groups remain explicitly blocked until a manager confirms that
each set represents one material.

## Verification

- API typecheck: passed.
- Focused existing cheese/heal tests: 15 passed.
- API workflow restart: completed successfully; `/api/healthz` returned 200.
- Development scan: rerun with the current detector; result retained above.
- Production scan: read-only historical result retained above; current-code
  production verification is **not verified** until publish.
- Confirmed profile-link repair coverage: the health report proposes exactly
  the five allowlisted source-backed replacements; unrelated missing links
  remain review-only.

## Release disposition

The detector inflation is corrected, valid exceptions are documented, and
remaining records have explicit owners and safe review boundaries. Publishing
is still required before the current detector and remaining review findings can
be verified against production.
