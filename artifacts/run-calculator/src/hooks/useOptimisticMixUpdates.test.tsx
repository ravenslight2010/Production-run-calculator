// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import type { Mix } from "@workspace/mixes";
import { useOptimisticMixUpdates } from "./useOptimisticMixUpdates";

const mix: Mix = {
  id: "mix-1",
  name: "Veggie mix",
  brand: "",
  flavor: "",
  components: [],
  batchSizeLbs: 10,
  amountAlreadyMade: 2,
  notes: "",
};

const otherMix: Mix = {
  ...mix,
  id: "mix-2",
  name: "Other mix",
  amountAlreadyMade: 1,
};

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("useOptimisticMixUpdates", () => {
  it("keeps the Mix Plan amount while a stale query refresh lands during a delayed save", () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(["mixes"], [mix, otherMix]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(
      ({ items }: { items: Mix[] }) => useOptimisticMixUpdates(items, queryClient),
      { wrapper, initialProps: { items: [mix, otherMix] } },
    );
    const optimistic = { ...mix, amountAlreadyMade: 7.5 };

    act(() => result.current.saveOptimistically(optimistic));
    expect(queryClient.getQueryData(["mixes"])).toEqual([optimistic, otherMix]);

    // The GET started before the POST finishes and returns the old server list.
    act(() => queryClient.setQueryData(["mixes"], [mix, otherMix]));
    rerender({ items: [mix, otherMix] });
    expect(result.current.mixPlanItems).toEqual([optimistic, otherMix]);

    act(() => result.current.acknowledgeSave(optimistic, [optimistic, otherMix]));
    rerender({ items: [optimistic, otherMix] });
    expect(queryClient.getQueryData(["mixes"])).toEqual([optimistic, otherMix]);
    expect(result.current.mixPlanItems).toEqual([optimistic, otherMix]);
  });

  it("keeps the Mix Plan amount after a failed save and a stale query refresh", () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(["mixes"], [mix, otherMix]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(
      ({ items }: { items: Mix[] }) => useOptimisticMixUpdates(items, queryClient),
      { wrapper, initialProps: { items: [mix, otherMix] } },
    );
    const optimistic = { ...mix, amountAlreadyMade: 7.5 };

    act(() => result.current.saveOptimistically(optimistic));
    // No acknowledgeSave call represents a rejected POST. A later stale GET
    // must still leave the warehouse plan at the manager's typed amount.
    act(() => queryClient.setQueryData(["mixes"], [mix, otherMix]));
    rerender({ items: [mix, otherMix] });

    expect(result.current.mixPlanItems).toEqual([optimistic, otherMix]);
    expect(queryClient.getQueryData(["mixes"])).toEqual([mix, otherMix]);
  });
});