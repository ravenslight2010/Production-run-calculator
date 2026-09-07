# Recipe Unit Confirmation Design

## Goal

Let managers confirm whether unclear imported recipe-row values are pounds or
ounces while preserving the source values exactly as parsed.

## Data model

`ParsedRecipe` keeps the source-reported `rowsUnit` and gains a separate,
optional confirmed unit limited to `lbs` or `oz`. The source label remains
available for audit and review. A confirmation is provenance only and must not
convert, scale, reorder, combine, or otherwise rewrite `rows`.

The confirmed unit follows the same recipe row set through merge and
sanitization. When a later source replaces a recipe's rows, confirmation from
the earlier row set must not leak onto the replacement unless the later source
contains that confirmation.

## Review interface

For a recipe whose reported unit is missing or ambiguous, the existing warning
offers optional Pounds and Ounces choices for the whole recipe. Managers may
leave the warning unconfirmed. Recipes with a clear source-reported unit remain
informational and do not need confirmation controls.

The selected confirmation is included in the edited parsed import submitted by
the dialog. It is restored whenever a saved import review is reopened because
saved reviews retain the parsed recipe metadata.

## Safety and compatibility

Existing imports without confirmed-unit metadata remain valid. Sanitization
accepts only the two supported canonical values and drops invalid values.
Confirmation logic operates by object metadata updates and never derives new
row amounts.

## Tests

Focused tests cover dough, sauce, and cheese recipes. They verify:

- missing and ambiguous units can be confirmed as pounds or ounces;
- emitted recipe rows remain exactly equal to their pre-confirmation rows;
- sanitization and merge preserve valid confirmation with its row set;
- a replacement row set does not inherit stale confirmation; and
- saved import serialization/reopening preserves the confirmation.