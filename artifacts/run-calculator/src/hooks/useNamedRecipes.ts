import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type NamedRecipeKind } from "../namedRecipes";
import { fetchMasterDataBootstrap } from "../masterData";
import type { NamedRecipe } from "@workspace/named-recipes";
import { useIdle } from "./useIdle";

// Factory-wide dough / sauce recipes, shared by the manager management UI and
// the run form's Dough / Sauce cards (which pick one and hydrate their rows from
// it). Polls in the background so a recipe a manager adds on one device shows up
// for the floor without a manual refresh. Open to everyone signed in (the GET
// endpoint is requireAuth, not manager-gated). Mirrors useCheeseRecipes.
//
// Idle throttling: steps from 60 s down to 5 min after 3 min of no activity.
// Startup jitter: polling begins after a random 0–10 s delay so a fresh page
// load doesn't fire all master-data queries simultaneously.
export function useNamedRecipes(kind: NamedRecipeKind): {
  items: NamedRecipe[];
  isLoading: boolean;
} {
  const isIdle = useIdle();

  const jitter = useMemo(() => Math.floor(Math.random() * 10_000), []);
  const [pollingReady, setPollingReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setPollingReady(true), jitter);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { data, isLoading } = useQuery({
    queryKey: [kind === "dough" ? "doughRecipes" : "sauceRecipes"],
    queryFn: () => fetchMasterDataBootstrap().then((data) =>
      kind === "dough" ? data.doughRecipes : data.sauceRecipes),
    staleTime: 30_000,
    refetchInterval: pollingReady ? (isIdle ? 300_000 : 60_000) : false,
  });
  return { items: data ?? [], isLoading };
}
