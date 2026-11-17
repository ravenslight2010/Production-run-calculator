import { useEffect } from "react";
import { applicatorStockFields, computeApplicatorStockCapacityLbs } from "@workspace/live-calc";
import { useStockDrafts } from "../../contexts/StockDraftContext";
import { useManualControlLock } from "../../manualSectionLocks";
import type { FormValues } from "../../types";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { ApplicatorStockRow } from "./ApplicatorStockRow";

export const PEPPERONI_SUPPLY_REGISTERS = ["pep1", "pep1b", "pep2", "pep2b"] as const;
export type PepperoniSupplyRegister = (typeof PEPPERONI_SUPPLY_REGISTERS)[number];

function supplyLabel(values: FormValues, register: PepperoniSupplyRegister) {
  const group = register.startsWith("pep1") ? "pep1" : "pep2";
  const typeField = register.endsWith("b") ? `${group}TypeB` as const : `${group}Type` as const;
  const type = String(values[typeField] ?? "").trim();
  if (!type) return undefined;
  return `Pep ${group.slice(3)}${register.endsWith("b") ? " additional" : ""} · ${type}`;
}

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
  useEffect(() => {
    for (const register of PEPPERONI_SUPPLY_REGISTERS) {
      const label = supplyLabel(values, register);
      const draft = drafts[register];
      // Blank setup hides a slot temporarily. A different configured product,
      // even while hidden by combined mode, retires the old product's draft.
      if (label !== undefined && draft && draft.label !== label) {
        delete drafts[register];
      }
    }
  }, [values, drafts]);
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
          const label = supplyLabel(values, register)!;
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
