// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BRANDS_KEY } from "../types";
import { directoryRaw } from "../factoryDirectory";
import { hydrateFromServer, resetFactoryDataSyncForTests, setFactoryDataIdentity } from "../factoryDataSync";
import { FactoryDirectoryStatus } from "./FactoryDirectoryStatus";

describe("legacy facility-list review", () => {
  beforeEach(() => {
    localStorage.clear();
    resetFactoryDataSyncForTests();
    setFactoryDataIdentity("live:manager", true);
    localStorage.setItem(BRANDS_KEY, '["Old Brand"]');
    hydrateFromServer({
      [BRANDS_KEY]: { value: ["Current Brand"], updatedAt: new Date().toISOString() },
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    resetFactoryDataSyncForTests();
    vi.restoreAllMocks();
  });

  it("compares readable current and saved values, then removes only the reviewed device copy", async () => {
    render(<FactoryDirectoryStatus />);

    expect(screen.getByText("Brands")).toBeTruthy();
    expect(screen.getByText(/Current Brand/)).toBeTruthy();
    expect(screen.getByText(/Old Brand/)).toBeTruthy();
    expect(screen.queryByText(/\[.*Brand.*\]/)).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove saved copy from this device" }));
    });

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("will not change the facility’s shared value"));
    expect(directoryRaw(BRANDS_KEY)).toBe('["Current Brand"]');
    expect(localStorage.getItem(BRANDS_KEY)).toBeNull();
    expect(screen.queryByText(/Old Brand/)).toBeNull();
    expect(screen.queryByText("Brands")).toBeNull();
  });
});
