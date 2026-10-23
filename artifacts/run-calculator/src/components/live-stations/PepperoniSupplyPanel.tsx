import { applicatorStockFields, computeApplicatorStockCapacityLbs } from "@workspace/live-calc";
import { useStockDrafts } from "../../contexts/StockDraftContext";
import { useManualControlLock } from "../../manualSectionLocks";
import type { FormValues } from "../../types";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { ApplicatorStockRow } from "./ApplicatorStockRow";

export const PEPPERONI_SUPPLY_REGISTERS = ["pep1", "pep1b", "pep2", "pep2b"] as const;
export type PepperoniSupplyRegister = (typeof PEPPERONI_SUPPLY_REGISTERS)[number];

/** Pepperoni loads are not batch recipes; preserve their separate pounds controls. */
export function PepperoniSupplyPanel({
  runId,
  values,
  isLive,
  onSave,
}: {
  runId: string;
  values: FormValues;
  isLive: boolean;
  onSave: (register: PepperoniSupplyRegister, stockLbs: number) => void;
}) {
  const drafts = useStockDrafts(runId);
  const locks = {
    pep1: useManualControlLock(runId, "pepperoni-1-stock"),
    pep2: useManualControlLock(runId, "pepperoni-2-stock"),
  };
  const source = values as unknown as Record<string, unknown>;
  const configured = PEPPERONI_SUPPLY_REGISTERS.filter(
    (register) => computeApplicatorStockCapacityLbs(source, register) > 0,
  );
  if (!configured.length) return null;
  return (
    <Card className="bg-card/60 border-border/50 shadow-md overflow-hidden mb-4">
      <CardHeader className="pb-2 pt-4 px-5">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Pepperoni on-line stock</CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <p className="text-xs text-muted-foreground mb-3">Record or correct the current pepperoni load after a refill. These loads remain in pounds, separate from applicator batches.</p>
        {configured.map((register) => {
          const fields = applicatorStockFields(register);
          const group = register.startsWith("pep1") ? "pep1" : "pep2";
          const lock = locks[group];
          const label = register.endsWith("b")
            ? `Pep ${register.slice(3, 4)} additional · ${String(source[`${group}TypeB`] ?? "").trim()}`
            : `Pep ${register.slice(3, 4)} · ${String(source[`${register}Type`] ?? "").trim()}`;
          const retained = drafts[register];
          return <ApplicatorStockRow
            key={`${register}-${runId}-${label}`}
            label={label}
            stockLbs={Number(source[fields.stock]) || 0}
            capacityLbs={computeApplicatorStockCapacityLbs(source, register)}
            disabled={!isLive || !!lock}
            disabledReason={lock?.peer ? "Stock adjustments unavailable while another station is editing." : undefined}
            testId={`stock-${register}-lbs`}
            initialDraft={retained?.label === label ? retained.value : undefined}
            onDraftChange={(draft) => {
              if (draft === undefined) delete drafts[register];
              else drafts[register] = { value: draft, label };
            }}
            onSave={(stockLbs) => onSave(register, stockLbs)}
          />;
        })}
      </CardContent>
    </Card>
  );
}
