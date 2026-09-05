import {
  createElement,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { normalizeIngredient, type Ingredient } from "@workspace/ingredient-catalog";
import { normalizeNamedRecipes, type NamedRecipe } from "@workspace/named-recipes";
import { normalizeCheeseRecipes, type CheeseRecipe } from "@workspace/cheese-recipes";
import { normalizeMixes, type Mix } from "@workspace/mixes";
import { inventoryClientId } from "./inventoryShared";
import { useIdle } from "./hooks/useIdle";

export const MASTER_DATA_QUERY_KEY = ["masterDataBootstrap"] as const;
export const MASTER_DATA_ACTIVE_INTERVAL_MS = 60_000;
export const MASTER_DATA_STALE_TIME_MS = 30_000;

export type MasterDataBootstrap = {
  ingredients: Ingredient[];
  doughRecipes: NamedRecipe[];
  sauceRecipes: NamedRecipe[];
  cheeseRecipes: CheeseRecipe[];
  mixes: Mix[];
};

export type MasterDataSlice = keyof MasterDataBootstrap;

function normalizeList<T>(items: unknown, normalize: (item: unknown) => T | null): T[] {
  return Array.isArray(items)
    ? items.map(normalize).filter((item): item is T => item !== null)
    : [];
}

let inFlight: Promise<MasterDataBootstrap> | null = null;

export function fetchMasterDataBootstrap(): Promise<MasterDataBootstrap> {
  if (inFlight) return inFlight;
  inFlight = fetch("/api/master-data/bootstrap", {
    headers: { "x-client-id": inventoryClientId() },
  }).then(async (res) => {
    if (!res.ok) throw new Error(`Load master data failed (${res.status})`);
    const data = await res.json() as Record<string, unknown>;
    return {
      ingredients: normalizeList(data.ingredients, normalizeIngredient),
      doughRecipes: normalizeNamedRecipes(data.doughRecipes),
      sauceRecipes: normalizeNamedRecipes(data.sauceRecipes),
      cheeseRecipes: normalizeCheeseRecipes(data.cheeseRecipes),
      mixes: normalizeMixes(data.mixes),
    };
  }).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

const LEGACY_QUERY_KEYS: Record<MasterDataSlice, readonly [string]> = {
  ingredients: ["ingredients"],
  doughRecipes: ["doughRecipes"],
  sauceRecipes: ["sauceRecipes"],
  cheeseRecipes: ["cheeseRecipes"],
  mixes: ["mixes"],
};

type MasterDataLifecycle = {
  pollingReady: boolean;
};

const MasterDataLifecycleContext = createContext<MasterDataLifecycle | null>(null);

let visibilityListeners = new Set<() => void>();

function pageIsVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

function subscribePageVisibility(callback: () => void): () => void {
  visibilityListeners.add(callback);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", callback);
  }
  return () => {
    visibilityListeners.delete(callback);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", callback);
    }
  };
}

function getPageVisibility(): boolean {
  return pageIsVisible();
}

function getServerPageVisibility(): boolean {
  return true;
}

function usePageVisibility(): boolean {
  return useSyncExternalStore(
    subscribePageVisibility,
    getPageVisibility,
    getServerPageVisibility,
  );
}

/**
 * Owns the one active master-data observer. The domain hooks below only select
 * from this query; they deliberately do not install their own polling timers.
 * Keeping this observer beside the authenticated calculator also prevents an
 * unauthenticated landing page from probing the protected endpoint.
 */
export function MasterDataPolling({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const isIdle = useIdle();
  const isVisible = usePageVisibility();
  const jitter = useMemo(() => Math.floor(Math.random() * 10_000), []);
  const [pollingReady, setPollingReady] = useState(false);
  const previousActiveRef = useRef<boolean | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setPollingReady(true), jitter);
    return () => clearTimeout(timer);
  }, [jitter]);

  const active = pollingReady && !isIdle && isVisible;
  useQuery({
    queryKey: MASTER_DATA_QUERY_KEY,
    queryFn: fetchMasterDataBootstrap,
    enabled: pollingReady,
    staleTime: MASTER_DATA_STALE_TIME_MS,
    refetchInterval: active ? MASTER_DATA_ACTIVE_INTERVAL_MS : false,
    // Foreground return is handled below so it shares the same deduplicated
    // query as activity wake-up instead of adding a second focus refetch.
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!pollingReady) return;
    const wasActive = previousActiveRef.current;
    previousActiveRef.current = active;
    if (active && wasActive === false) {
      void queryClient.refetchQueries({
        queryKey: MASTER_DATA_QUERY_KEY,
        type: "active",
      });
    }
  }, [active, pollingReady, queryClient]);

  return createElement(
    MasterDataLifecycleContext.Provider,
    { value: { pollingReady } },
    children,
  );
}

/**
 * Select one normalized list from the canonical bootstrap response. The
 * fallback enabled=true keeps isolated manager/component tests and direct
 * consumers functional; the authenticated app supplies MasterDataPolling,
 * which gates the first request behind its single startup jitter.
 */
export function useMasterDataSlice<K extends MasterDataSlice>(slice: K) {
  const lifecycle = useContext(MasterDataLifecycleContext);
  return useQuery({
    queryKey: MASTER_DATA_QUERY_KEY,
    queryFn: fetchMasterDataBootstrap,
    enabled: lifecycle?.pollingReady ?? true,
    staleTime: MASTER_DATA_STALE_TIME_MS,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    select: (data) => data[slice],
  });
}

export function setMasterDataSlice<K extends MasterDataSlice>(
  queryClient: QueryClient,
  slice: K,
  value: MasterDataBootstrap[K],
): void {
  queryClient.setQueryData<MasterDataBootstrap>(
    MASTER_DATA_QUERY_KEY,
    (current) => current
      ? { ...current, [slice]: value } as MasterDataBootstrap
      : current,
  );
  // Keep old keys coherent for code/tests that still use them directly while
  // ensuring all user-facing domain hooks read from the canonical record.
  queryClient.setQueryData<MasterDataBootstrap[K]>(
    LEGACY_QUERY_KEYS[slice],
    value,
  );
}

export function updateMasterDataSlice<K extends MasterDataSlice>(
  queryClient: QueryClient,
  slice: K,
  updater: (current: MasterDataBootstrap[K] | undefined) => MasterDataBootstrap[K] | undefined,
): void {
  queryClient.setQueryData<MasterDataBootstrap>(
    MASTER_DATA_QUERY_KEY,
    (current) => {
      if (!current) return current;
      return {
        ...current,
        [slice]: updater(current[slice]),
      } as MasterDataBootstrap;
    },
  );
  queryClient.setQueryData<MasterDataBootstrap[K]>(
    LEGACY_QUERY_KEYS[slice],
    (current) => updater(current),
  );
}

export async function invalidateMasterDataSlice(
  queryClient: QueryClient,
  slice: MasterDataSlice,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: MASTER_DATA_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: LEGACY_QUERY_KEYS[slice] }),
  ]);
}