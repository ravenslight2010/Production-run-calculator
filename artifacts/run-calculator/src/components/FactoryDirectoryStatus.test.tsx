// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { BRANDS_KEY, STOP_REASONS_KEY } from "../types";
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

  it("removes multiple eligible copies sequentially and confirms the final removal", async () => {
    localStorage.setItem(STOP_REASONS_KEY, '["Old stop reason"]');
    render(<FactoryDirectoryStatus />);

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Remove saved copy from this device" })[0]);
    });
    expect(localStorage.getItem(BRANDS_KEY)).toBeNull();
    expect(localStorage.getItem(STOP_REASONS_KEY)).toBe('["Old stop reason"]');

    const stopReasons = screen.getByRole("heading", { name: "Stop reasons" }).closest("div")!;
    await act(async () => {
      fireEvent.click(within(stopReasons).getByRole("button", { name: "Remove saved copy from this device" }));
    });

    expect(localStorage.getItem(STOP_REASONS_KEY)).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Saved copy removed from this device.");
    expect(screen.queryByRole("button", { name: "Remove saved copy from this device" })).toBeNull();
  });

  it("clearly disables removal for an edit that may still be unsent", () => {
    const queue = JSON.stringify([{ key: BRANDS_KEY, value: ["Pending Brand"], updatedAt: 1, g: 1 }]);
    localStorage.setItem("run-calc-fkv-queue-v1", queue);
    render(<FactoryDirectoryStatus />);

    const button = screen.getByRole("button", { name: "Removal unavailable" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/may not have been sent to the facility yet/)).toBeTruthy();
    expect(localStorage.getItem("run-calc-fkv-queue-v1")).toBe(queue);
  });
});
