---
name: Brand quote-typo folding
description: AI parses can mint punctuation-typo brands (Aldo"s vs Aldo's); how the match keys, sanitizer snap, and apply-path heals prevent split brands.
---

# Brand quote-typo folding

The AI spec parse can mint a brand with a straight double-quote where an apostrophe belongs (`Aldo"s`). Because saved sheets reuse stored parses, one bad parse silently splits the brand across every downstream match/grounding pass, and Auto-Fill then finds the recipe (loose name grounding) but misses the profile row values (brand-keyed lookup).

**Rule:** `specImportNameMatchKey` folds letter-bounded straight/curly double quotes like apostrophes (letter-bounded so inch marks `12"` keep distinct keys). `sanitizeParsedSpecImport` snaps a parsed brand to a known brand whose `specImportBrandMatchKey` matches (warn unless case-only; first known brand wins on key ties — policy locked by test). Client heal layers: planner `brandsEqual` (exact-lowercase then brand-key, exact row preferred) and `applySpecImport` canonicalizes parsed brands onto existing registry spellings by brand key.

**Why:** the loose key folded `' ’ \`` but not `"`, so a single typo character made a brand invisible to every matcher. Heal-at-read layers were needed because saved sheets store the bad parse (hash reuse) — no re-import or SPEC_PARSE_VERSION bump required.

**How to apply:** any new brand-keyed lookup (planner, apply, server pool re-point) must go through the brand-key comparison, not raw string equality. If adding punctuation folds, keep them letter-bounded and re-run the inch-mark tests.
