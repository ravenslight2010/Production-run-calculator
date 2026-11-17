import type { SpecAliasKind } from "@workspace/spec-import";

export type SpecImportAliasDeletionEntry = {
  kind: SpecAliasKind;
  externalName: string;
  canonicalName: string;
  context: string | null;
};

type StoredSpecImportAlias = SpecImportAliasDeletionEntry;

/**
 * The legacy delete endpoint treats a null requested context as a wildcard.
 * Correcting workbook imports know the full alias key, including an explicitly
 * null context, and therefore opt into exact matching so a brand-scoped sibling
 * mapping cannot be deleted accidentally.
 */
export function matchesSpecImportAliasDeletion(
  row: StoredSpecImportAlias,
  entry: SpecImportAliasDeletionEntry,
  exactContext: boolean,
): boolean {
  if (row.kind !== entry.kind) return false;
  if (row.externalName.trim().toLowerCase() !== entry.externalName.toLowerCase()) return false;
  if (row.canonicalName.trim().toLowerCase() !== entry.canonicalName.toLowerCase()) return false;
  if (entry.context === null) {
    return !exactContext || (row.context ?? null) === null;
  }
  return (row.context ?? "").trim().toLowerCase() === entry.context.toLowerCase();
}