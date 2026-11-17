// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MixSurplusLedger } from "../mixSurplusClient";

function ledgerBalance(over: { mixId?: string; lbs?: number; name?: string; productionDates?: string[] } = {}) {
  return { mixId: over.mixId ?? "m1", name: over.name ?? "Bobo's Veggie Mix", lbs: over.lbs ?? 10, productionDates: over.productionDates ?? ["2026-09-14"] };
}

function ledgerLot(over: Partial<{ id: string; mixId: string; productionDate: string; amountRemaining: number; amountMade: number }> = {}) {
  return {
    id: over.id ?? "l1",
    mixId: over.mixId ?? "m1",
    name: "Bobo's Veggie Mix",
    productionDate: over.productionDate ?? "2026-09-14",
    location: "freezer",
    amountMade: over.amountMade ?? 60,
    amountUsed: 0,
    amountRemaining: over.amountRemaining ?? 10,
  };
}

function ledger(overrides: Partial<MixSurplusLedger> = {}): MixSurplusLedger {
  return {
    lots: overrides.lots ?? [ledgerLot()],
    allocations: overrides.allocations ?? [],
    balances: overrides.balances ?? [ledgerBalance()],
  };
}

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ toast }));

const replaceAllocations = vi.fn(async () => ledger());
const voidLot = vi.fn(async () => ledger());

vi.mock("../mixSurplusClient", () => ({
  replaceMixSurplusAllocations: (...args: unknown[]) => replaceAllocations(...args),
  voidMixSurplusLot: (...args: unknown[]) => voidLot(...args),
}));

import { MixSurplusStrip } from "./MixSurplusStrip";

function noop() {}

afterEach(() => {
  cleanup();
  toast.mockClear();
  replaceAllocations.mockClear();
  voidLot.mockClear();
});

describe("MixSurplusStrip", () => {
  it("renders nothing when there is no balance for the mix", () => {
    const { container } = render(
      <MixSurplusStrip mixId="missing" ledger={ledger()} makeDay="2026-09-15" canManage={false} onLedgerChanged={noop} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows the balance and lot rows when present", () => {
    render(
      <MixSurplusStrip mixId="m1" ledger={ledger()} makeDay="2026-09-15" canManage={true} onLedgerChanged={noop} />,
    );
    expect(screen.getAllByText(/10.00/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Bobo's Veggie Mix/)).toBeTruthy();
    expect(screen.getAllByText(/2026-09-14/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Use on next run/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Release/i })).toBeTruthy();
  });

  it("hides action buttons when canManage is false", () => {
    render(
      <MixSurplusStrip mixId="m1" ledger={ledger()} makeDay="2026-09-15" canManage={false} onLedgerChanged={noop} />,
    );
    expect(screen.getAllByText(/10.00/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Use on next run/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Release/i })).toBeNull();
  });

  it("calls replaceMixSurplusAllocations with full remaining on 'Use'", async () => {
    const onLedgerChanged = vi.fn();
    render(
      <MixSurplusStrip mixId="m1" ledger={ledger()} makeDay="2026-09-15" canManage={true} onLedgerChanged={onLedgerChanged} />,
    );
    replaceAllocations.mockResolvedValueOnce(ledger({ lots: [ledgerLot({ amountRemaining: 0 })] }));
    await userEvent.click(screen.getByRole("button", { name: /Use on next run/i }));
    expect(replaceAllocations).toHaveBeenCalledWith("2026-09-15", [{ lotId: "l1", amount: 10 }]);
    expect(onLedgerChanged).toHaveBeenCalled();
  });

  it("calls voidMixSurplusLot on 'Release'", async () => {
    const onLedgerChanged = vi.fn();
    render(
      <MixSurplusStrip mixId="m1" ledger={ledger()} makeDay="2026-09-15" canManage={true} onLedgerChanged={onLedgerChanged} />,
    );
    voidLot.mockResolvedValueOnce(ledger({ lots: [] }));
    await userEvent.click(screen.getByRole("button", { name: /Release/i }));
    expect(voidLot).toHaveBeenCalledWith("l1");
    expect(onLedgerChanged).toHaveBeenCalled();
  });

  it("shows an error toast when the server rejects", async () => {
    render(
      <MixSurplusStrip mixId="m1" ledger={ledger()} makeDay="2026-09-15" canManage={true} onLedgerChanged={noop} />,
    );
    voidLot.mockRejectedValueOnce(new Error("no"));
    await userEvent.click(screen.getByRole("button", { name: /Release/i }));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  });
});
