---
name: Premix sheet import
description: In-app premix .xlsx import in the Mixes section (web+mobile) — deterministic parse lib, AI name-only matcher, contract & parity gotchas.
---

# Premix sheet import

Managers upload premix `.xlsx` workbooks in the **Mixes** section on BOTH apps. Each
product tab/block → a Mix (name, AI-matched brand+flavor, `batchSize` = the block
"Total"/"Per Batch" lbs, `components[{ingredient, perPizza}]`, `daysEarly` + raw
"Pull N Days Early" note). Re-import upserts by deterministic id (no dupes).

## Where it lives
- Pure logic: `@workspace/premix-import` (`parsePremixWorkbook`, `groundPremix`,
  `applyPremixMatches`, `premixToMix`/`premixId`, `summarizePremixImport`,
  `mergePremixIntoMixes`, `collectPremixAliases`). All quantities are DETERMINISTIC here.
- Server AI matcher: `/ai/match-premix` (`aiMatchPremix.ts`) — disambiguates PRODUCT
  names ONLY, never quantities. Manager-gated (`use-ai-tools`), rate-limited, sanitized.
- Web glue: `src/premixImport.ts` + `src/premixMatch.ts` + `components/PremixImportDialog.tsx`,
  wired in `home.tsx` Mixes section.
- Mobile glue: `context/premixImport.ts` + `context/premixMatch.ts` +
  `components/PremixImportModal.tsx`, wired in `app/master-data.tsx` Mixes section.

## Gotchas / decisions
- **Match-premix request field is `unmatchedNames`, NOT `names`.** The server contract
  (OpenAPI `MatchPremixInput` → generated zod) requires `unmatchedNames`. The client glue
  uses a hand-written local `MatchPremixInput` type + raw `fetch(JSON.stringify(...))`, so a
  wrong field name TYPECHECKS CLEAN but every call 400s and silently falls back to
  deterministic-only grounding (AI never runs). If AI matching "does nothing", check this
  field name first. **Why:** the local types aren't anchored to the generated schema, mirroring
  the existing `matchImport.ts` pattern — drift is invisible to tsc.
- **Premix import button is gated on `isManager`** (inside the `canManageInventory` Mixes
  section) on BOTH apps. **Why:** parity — web chose manager-only for the import action even
  though the Mixes section itself shows for any manage-inventory user; mobile must match.
- AI is advisory/fail-safe: any failure (not a manager, AI down, sync disabled) is caught and
  the import proceeds with deterministic grounding. Confirmation-based; writes only through the
  existing manager-gated `saveMixes` path. Mixes are master-data — NOT in `/sync`.
- Mobile injects a `PremixImportStore` ({known: PremixKnown}) built from RunContext; web reads
  localStorage via `loadSpecImportKnown`. `PremixKnown.ingredients` = union of
  cheese+dough+sauce (frontline) ingredient pools on both platforms.
- Reuses learned spec-import alias memory (`fetchSpecImportAliases`/`saveSpecImportAliases`)
  and mirrors new brand/flavor mappings into the factory-wide AI corrections pool, both
  best-effort.
