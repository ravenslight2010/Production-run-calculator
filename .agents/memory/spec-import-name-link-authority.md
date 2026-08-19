---
name: Spec re-import name-link authority
description: Why the re-import snapshot prune must never gate profile name links, and why import name links must resolve through the factory merge history.
---

**Rule:** the spec sheet is authoritative for a profile's sauce/dough/mix/cheese name links. Never skip applying them because a snapshot diff says "unchanged", and never trust a stored-name equality guard. Any import path that writes a pool-recipe name link must first resolve the sheet's name through the factory merge history (merge_aliases), following chains to the surviving canonical name — and merged-away names must be usable as MATCH candidates, not just rewritten after matching, or a sheet naming only the old name never links at all.

**Why:** an import snapshot records what the sheet said last time, not what the profile actually stores. A prior bad import (or a later merge/rename) can leave a wrong stored link while the sheet is byte-identical — pruning made a correcting re-import a silent no-op and required a manual production data heal (the Hannaford Tikka Masala incident).

**How to apply:** when adding any "skip if unchanged" optimization to an import pipeline, exclude fields whose stored value can drift from the sheet independently (name links, and the lists they're re-resolved from). Started runs stay frozen — profile fan-out already only touches not-started runs.
