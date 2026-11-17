// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchPhotoAliases = vi.fn();
vi.mock("./inventoryShared", () => ({
  fetchPhotoAliases: (...args: unknown[]) => fetchPhotoAliases(...args),
}));

import {
  refreshPhotoAliasesCache,
  resetPhotoAliasesStoreForTests,
  usePhotoAliases,
} from "./photoAliasesStore";

function MountedPhotoAliasConsumer() {
  const aliases = usePhotoAliases();
  return <div data-testid="aliases">{aliases.map((alias) => alias.guessName).join(",")}</div>;
}

describe("photo alias live cache", () => {
  beforeEach(() => {
    resetPhotoAliasesStoreForTests();
    fetchPhotoAliases.mockReset();
  });

  it("updates an already-mounted consumer after a canonical invalidation refresh", async () => {
    fetchPhotoAliases.mockResolvedValueOnce([]);
    render(<MountedPhotoAliasConsumer />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("aliases").textContent).toBe("");

    fetchPhotoAliases.mockResolvedValueOnce([
      { guessName: "Hormel Pepperoni", itemKey: "pepperoni" },
    ]);
    await act(async () => {
      await refreshPhotoAliasesCache();
    });

    expect(screen.getByTestId("aliases").textContent).toContain("Hormel Pepperoni");
  });
});