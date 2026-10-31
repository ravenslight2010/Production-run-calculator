import { freshSourceReconciliationStatus } from "./contract";
// Intentionally does not import the DB, filesystem, historical plan or verifier.
export async function sourceLibraryReconciliationStatus() {
  return freshSourceReconciliationStatus();
}
