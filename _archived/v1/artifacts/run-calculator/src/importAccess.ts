/**
 * Maps import/export controls to the capabilities their real commit paths need.
 * This is a client-side visibility guard only; the API remains the authority.
 */
export type ImportAccess = {
  canImportSpec: boolean;
  canImportPremixOrCheese: boolean;
  canImportProfileGuide: boolean;
  canExportSpec: boolean;
};

export function getImportAccess(capabilities: ReadonlySet<string>): ImportAccess {
  const canManageProfiles = capabilities.has("manage-profiles");
  const canManageInventory = capabilities.has("manage-inventory");
  return {
    // Deterministic parsing is available without AI. The commit still rewrites
    // both profiles and recipe pools, so both write capabilities are required.
    canImportSpec: canManageProfiles && canManageInventory,
    // Both workbooks commit inventory master data (recipes/mixes/freezer pulls).
    canImportPremixOrCheese: canManageInventory,
    // These guides only rewrite saved setup profile values.
    canImportProfileGuide: canManageProfiles,
    // Export is local, but only expose factory setup data to a role that can
    // administer one of the datasets represented in that workbook.
    canExportSpec: canManageProfiles || canManageInventory,
  };
}