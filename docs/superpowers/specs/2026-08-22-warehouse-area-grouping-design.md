# Warehouse Area Grouping Design

## Goal

Make Warehouse pull lists easier to scan by grouping needs into production
areas: Dough, Sauce, Frontline, and Packaging.

## Scope

- Group the existing **Total Ingredient Needs — All Runs** rows into Dough,
  Sauce, and Frontline.
- Keep **Packaging Needs — All Runs** as its own Packaging area.
- Group **What Each Run Needs** using the same four area labels.
- Preserve all current calculations, units, staging check-offs, row actions,
  and run selection behavior.
- Omit empty groups.
- Use semantic headings and responsive stacked sections so the layout remains
  usable on phone, tablet, and desktop.

## Classification

The existing calculation paths remain the source of truth. Dough recipe
ingredients classify as Dough, sauce recipe ingredients classify as Sauce, and
applicator ingredients (cheese, pepperoni, and mixes) classify as Frontline.
Packaging rows remain Packaging.

The grouping helper will be shared by the all-runs and per-run render paths so
the two views cannot develop different area rules.

## Testing

Add client coverage for the shared grouping behavior, including populated and
empty areas, and verify the Warehouse render shows matching area headings in
both all-runs and per-run views without changing totals.