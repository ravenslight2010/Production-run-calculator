import { useEffect, useSyncExternalStore } from "react";
import { fetchPhotoAliases, type PhotoAlias } from "./inventoryShared";

let aliases: PhotoAlias[] = [];
let refreshInFlight: Promise<PhotoAlias[]> | null = null;
const listeners = new Set<() => void>();

function publish(next: PhotoAlias[]): void {
  aliases = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): PhotoAlias[] {
  return aliases;
}

export function setPhotoAliasesCache(next: PhotoAlias[]): void {
  publish([...next]);
}

/** Reload the facility-wide aliases from their canonical endpoint. */
export function refreshPhotoAliasesCache(): Promise<PhotoAlias[]> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = fetchPhotoAliases()
    .then((next) => {
      publish(next);
      return next;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

/** Shared live view used by mounted photo-intake consumers. */
export function usePhotoAliases(): PhotoAlias[] {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    void refreshPhotoAliasesCache().catch(() => {
      // Best-effort: retain the last canonical snapshot while offline.
    });
  }, []);
  return current;
}

export function resetPhotoAliasesStoreForTests(): void {
  aliases = [];
  refreshInFlight = null;
  listeners.clear();
}