import type { UseFormReturn } from "react-hook-form";
import { resolveLineTiming } from "@workspace/live-calc";
import type { FormValues } from "../types";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "./ui/form";
import { Input } from "./ui/input";
import { NumField } from "./NumField";

/** Edits go through the existing permission-gated, stamped Setup save path. */
export function LineTransitSettings({ form, values }: { form: UseFormReturn<FormValues>; values: FormValues }) {
  const timing = resolveLineTiming(values);
  return <div className="space-y-3" data-testid="line-transit-settings">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {(["pressOvenMin", "frontlineMin"] as const).map((name) => <FormField
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
              if (form.getValues(other) === undefined) form.setValue(other, timing[other], { shouldDirty: true });
              field.onChange(value);
              if (value !== undefined && Number.isFinite(value) && value >= 0) {
                form.setValue("preTunnelMin", value + (form.getValues(other) ?? timing[other]), { shouldDirty: true });
              }
            }} />
          </FormControl><FormMessage />
        </FormItem>} />)}
      <NumField control={form.control} name="postTunnelMin" label="Wrapper / Packaging transit (min)" step="any" />
    </div>
    {timing.compatibilityAllocation && <p className="text-xs text-muted-foreground">
      Provisional split: half of the saved pre-tunnel time per section. Edit to replace this allocation; these are not measured factory times.
    </p>}
    <p className="text-xs text-muted-foreground" data-testid="line-transit-total">
      {timing.pressOvenMin.toFixed(2)} Press / Oven + {timing.frontlineMin.toFixed(2)} Frontline + {timing.tunnelMin.toFixed(2)} Freeze Tunnel + {timing.postTunnelMin.toFixed(2)} Wrapper / Packaging = {timing.totalMin.toFixed(2)} min total.
      {" "}Press / Oven carries pairs; Frontline carries single pizzas. Two pizzas remain two pizzas.
    </p>
    {(Number(values.pressOvenMin ?? timing.pressOvenMin) + Number(values.frontlineMin ?? timing.frontlineMin) +
      Number(values.postTunnelMin)) > Number(values.freezerTime) && <p role="status" className="text-xs text-amber-600">
      Section times exceed total line time. Calculations proportionally fit them to the total shown above; total transit time is not increased.
    </p>}
  </div>;
}
