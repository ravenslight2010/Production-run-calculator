import type { UseFormReturn } from "react-hook-form";
import { resolveLineTiming } from "@workspace/live-calc";
import type { FormValues } from "../types";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "./ui/form";
import { Input } from "./ui/input";
import { NumField } from "./NumField";

/** Edits go through the existing permission-gated, stamped Setup save path. */
export function LineTransitSettings({
  form,
  values,
  isCrust = false,
}: {
  form: UseFormReturn<FormValues>;
  values: FormValues;
  isCrust?: boolean;
}) {
  const timing = resolveLineTiming({ ...values, isCrust });
  const transitFields = isCrust
    ? (["frontlineMin"] as const)
    : (["pressOvenMin", "frontlineMin"] as const);
  const configuredOuterMin = isCrust
    ? Number(values.frontlineMin ?? timing.frontlineMin) + Number(values.postTunnelMin)
    : Number(values.pressOvenMin ?? timing.pressOvenMin) +
      Number(values.frontlineMin ?? timing.frontlineMin) + Number(values.postTunnelMin);
  return <div className="space-y-3" data-testid="line-transit-settings">
    {isCrust && <p
      className="text-xs text-muted-foreground"
      role="status"
      data-testid="crust-press-oven-bypass"
    >
      Premade crust runs start at Frontline; Press / Oven transit is bypassed.
    </p>}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {transitFields.map((name) => <FormField
        key={name} control={form.control} name={name}
        render={({ field }) => <FormItem>
          <FormLabel className="text-xs text-muted-foreground">
            {name === "pressOvenMin" ? "Press / Oven transit (min)" : "Frontline transit (min)"}
          </FormLabel>
          <FormControl><Input {...field} type="number" min="0" step="any" inputMode="decimal"
            value={field.value ?? timing[name]}
            data-testid={`input-${name}`}
            onChange={(event) => {
              const value = event.target.value === "" ? undefined : Number(event.target.value);
              // Materialize the other provisional half on the first edit, so
              // editing one duration never silently changes the other.
              const other = name === "pressOvenMin" ? "frontlineMin" : "pressOvenMin";
              if (!isCrust && form.getValues(other) === undefined) {
                form.setValue(other, timing[other], { shouldDirty: true });
              }
              field.onChange(value);
              if (value !== undefined && Number.isFinite(value) && value >= 0) {
                const otherValue = isCrust ? 0 : (form.getValues(other) ?? timing[other]);
                form.setValue("preTunnelMin", value + otherValue, { shouldDirty: true });
              }
            }} />
          </FormControl><FormMessage />
        </FormItem>} />)}
      <NumField control={form.control} name="postTunnelMin" label="Wrapper / Packaging transit (min)" step="any" />
    </div>
    {timing.compatibilityAllocation && <p className="text-xs text-muted-foreground">
      {isCrust
        ? "Provisional Frontline timing uses the saved pre-tunnel duration; Press / Oven remains bypassed."
        : "Provisional split: half of the saved pre-tunnel time per section. Edit to replace this allocation; these are not measured factory times."}
    </p>}
    <p className="text-xs text-muted-foreground" data-testid="line-transit-total">
      {isCrust ? "Press / Oven bypassed" : `${timing.pressOvenMin.toFixed(2)} Press / Oven`} + {timing.frontlineMin.toFixed(2)} Frontline + {timing.tunnelMin.toFixed(2)} Freeze Tunnel + {timing.postTunnelMin.toFixed(2)} Wrapper / Packaging = {timing.totalMin.toFixed(2)} min total.
      {" "}{isCrust
        ? "Crust runs begin at Frontline."
        : "Press / Oven carries pairs; Frontline carries single pizzas. Two pizzas remain two pizzas."}
    </p>
    {configuredOuterMin > Number(values.freezerTime) && <p role="status" className="text-xs text-amber-600">
      Section times exceed total line time. Calculations proportionally fit them to the total shown above; total transit time is not increased.
    </p>}
  </div>;
}
