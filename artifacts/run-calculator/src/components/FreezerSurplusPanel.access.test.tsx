// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FreezerSurplusLedger } from "@workspace/freezer-pull";
import type { RunMeta } from "../types";

const mocks = vi.hoisted(() => ({
  hasCapability: vi.fn(),
}));

vi.mock("../useRole", () => ({
  useMe: () => ({ hasCapability: mocks.hasCapability }),
}));

import { FreezerSurplusPanel } from "./FreezerSurplusPanel";

const completedRun: RunMeta = {
  id: "run-1",
  brand: "Northstar",
  flavor: "Pepperoni",
  endedAt: 1_000,
};

const pendingRun: RunMeta = {
  id: "run-2",
  brand: "Northstar",
  flavor: "Pepperoni",
};

const ledger: FreezerSurplusLedger = {
  lots: [
    {
      id: "lot-1",
      brand: "Northstar",
      flavor: "Pepperoni",
      productKey: "northstar::pepperoni",
      productionDate: "2026-09-07",
      totalCases: 4,
      remainingCases: 4,
    },
  ],
  allocations: [],
};

function renderPackaging(overrides: Partial<React.ComponentProps<typeof FreezerSurplusPanel>> = {}) {
  return render(
    <FreezerSurplusPanel
      mode="packaging"
      ledger={ledger}
      loaded
      busy={false}
      error={null}
      completedRun={completedRun}
      freezerTimeMin={1}
      nowMs={1_000}
      getOriginalTarget={() => 12}
      onConfirm={vi.fn().mockResolvedValue(undefined)}
      onAllocate={vi.fn().mockResolvedValue(undefined)}
      {...overrides}
    />,
  );
}

function renderWarehouse(overrides: Partial<React.ComponentProps<typeof FreezerSurplusPanel>> = {}) {
  return render(
    <FreezerSurplusPanel
      mode="warehouse"
      ledger={ledger}
      loaded
      busy={false}
      error={null}
      pendingRuns={[pendingRun]}
      getOriginalTarget={() => 12}
      onConfirm={vi.fn().mockResolvedValue(undefined)}
      onAllocate={vi.fn().mockResolvedValue(undefined)}
      {...overrides}
    />,
  );
}

afterEach(() => {
  cleanup();
  mocks.hasCapability.mockReset();
});

describe("FreezerSurplusPanel capability gates", () => {
  it("keeps surplus recording read-only without manage-inventory", () => {
    mocks.hasCapability.mockReturnValue(false);
    const onConfirm = vi.fn().mockResolvedValue(undefined);

    renderPackaging({ onConfirm });

    expect(screen.queryByRole("spinbutton", { name: "Excess finished cases" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm surplus" })).toBeNull();
    expect(screen.getByText(/requires inventory management access/i)).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("allows managers to record finished-case freezer surplus", async () => {
    mocks.hasCapability.mockReturnValue(true);
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPackaging({ onConfirm });

    await user.type(screen.getByRole("spinbutton", { name: "Excess finished cases" }), "3");
    await user.click(screen.getByRole("button", { name: "Confirm surplus" }));

    expect(onConfirm).toHaveBeenCalledWith(completedRun, 3, expect.any(String));
  });

  it("does not expose pull controls without manage-inventory", () => {
    mocks.hasCapability.mockReturnValue(false);

    renderWarehouse();

    expect(screen.getByTestId("freezer-surplus-run-run-2")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /choose pull|revise pull/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm pull" })).toBeNull();
    expect(screen.getByText(/requires inventory management access/i)).toBeTruthy();
  });

  it("allows managers to choose and confirm a freezer pull", async () => {
    mocks.hasCapability.mockReturnValue(true);
    const onAllocate = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderWarehouse({ onAllocate });

    await user.click(screen.getByRole("button", { name: "Choose pull" }));
    const cases = screen.getByRole("spinbutton", { name: "Cases from freezer lot dated 2026-09-07" });
    await user.clear(cases);
    await user.type(cases, "2");
    await user.click(screen.getByRole("button", { name: "Confirm pull" }));

    expect(onAllocate).toHaveBeenCalledWith(pendingRun, [{ lotId: "lot-1", cases: 2 }]);
  });
});