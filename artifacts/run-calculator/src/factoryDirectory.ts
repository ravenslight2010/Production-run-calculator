import { OPERATIONAL_DIRECTORY_KEYS } from "@workspace/factory-constants";

export const DIRECTORY_METADATA_KEYS: ReadonlySet<string> = new Set([
  "run-calc-merged-away", "run-calc-deleted-items", "run-calc-deleted-stamps", "run-calc-undeleted-stamps",
]);
export const MEMORY_DIRECTORY_KEYS: ReadonlySet<string> = new Set(
  OPERATIONAL_DIRECTORY_KEYS.filter((key) => !DIRECTORY_METADATA_KEYS.has(key)),
);
export type DirectoryStatus = "loading" | "ready" | "unavailable";
let identity: string | null = null;
let epoch = 0;
let status: DirectoryStatus = "loading";
let error: string | null = null;
const values = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;
let batching = 0;
function emit(): void { if (batching) return; version++; for (const listener of listeners) listener(); }
export function batchDirectoryUpdates(run: () => void): void {
  batching++;
  try { run(); } finally { batching--; emit(); }
}
export function subscribeFactoryDirectory(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const factoryDirectoryVersion = () => version;
export function notifyFactoryDirectory(): void { emit(); }
export const factoryDirectoryState = () => ({ identity, epoch, status, error });
export function setFactoryDirectoryIdentity(next: string | null): void {
  if (next === identity) return;
  identity = next;
  epoch++;
  values.clear();
  status = "loading";
  error = null;
  emit();
}
export function setFactoryDirectoryStatus(next: DirectoryStatus, message: string | null = null): void {
  status = next; error = message; emit();
}
export function directoryRaw(key: string): string | null { return values.get(key) ?? null; }
export function metadataStorageKey(key: string): string | null {
  return identity ? `run-calc-fkv-metadata:${encodeURIComponent(identity)}:${key}` : key;
}
export function setDirectoryRaw(key: string, value: string): void {
  if (values.get(key) === value) return;
  values.set(key, value); emit();
}
export function removeDirectoryRaw(key: string): void { if (values.delete(key)) emit(); }
export function directoryEntries(): Array<[string, string]> { return [...values]; }
export function resetFactoryDirectoryForTests(): void {
  identity = null; epoch++; status = "loading"; error = null; values.clear(); emit();
}
