import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { GetFieldChecksParams } from "../inventoryShared";

const categories = [
  ["desktop-chrome", "Desktop Chrome"], ["desktop-safari", "Desktop Safari"],
  ["desktop-firefox", "Desktop Firefox"], ["mobile-chrome", "Mobile Chrome"],
  ["mobile-safari", "Mobile Safari"], ["tablet-browser", "Tablet browser"],
  ["other-browser", "Other browser"],
  ["android-phone", "Android phone (guided hardware)"],
  ["android-tablet", "Android tablet (guided hardware)"],
  ["ipad", "iPad (guided hardware)"], ["iphone", "iPhone (guided hardware)"],
] as const;

export function FieldEvidenceFilters({ filters, onApply }: {
  filters: GetFieldChecksParams;
  onApply: (filters: GetFieldChecksParams) => void;
}) {
  const id = useId();
  const [buildMode, setBuildMode] = useState("all");
  const [build, setBuild] = useState("");
  const [category, setCategory] = useState<GetFieldChecksParams["deviceCategory"]>();
  const controlClass = "min-h-11 w-full min-w-0 rounded-md border border-border bg-background px-2 text-sm";
  const apply = () => {
    if (buildMode === "exact" && !build.trim()) return;
    onApply({
      ...(buildMode === "unknown" ? { appBuild: "local" }
        : buildMode === "exact" ? { appBuild: build.trim() } : {}),
      ...(category ? { deviceCategory: category } : {}),
    });
  };
  return (
    // Reported issues is rendered inside Home's outer form. Never nest a form
    // or submit it: native form handling can reload Home and lose the selection.
    <div role="group" aria-label="Field evidence filters" className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="min-w-0 text-xs font-medium">
          <label htmlFor={`${id}-build`}>Build</label>
          <div className="relative">
          <select id={`${id}-build`} className={`${controlClass} appearance-none pr-8 text-foreground`} value={buildMode} onChange={(event) => setBuildMode(event.target.value)}>
            <option value="all">All builds</option>
            <option value="unknown">Unknown build (local)</option>
            <option value="exact">Exact build identifier</option>
          </select>
          <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>
        <div className="min-w-0 text-xs font-medium">
          <label htmlFor={`${id}-category`}>Browser category</label>
          <div className="relative">
          <select id={`${id}-category`} className={`${controlClass} appearance-none pr-8 text-foreground`} value={category ?? ""} onChange={(event) => {
            setCategory((event.target.value || undefined) as GetFieldChecksParams["deviceCategory"]);
          }}>
            <option value="">All browser / device categories</option>
            {categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>
        {buildMode === "exact" && (
          <label className="min-w-0 text-xs font-medium sm:col-span-2">
            Exact build identifier
            <input className={controlClass} value={build} maxLength={100}
              onChange={(event) => setBuild(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); apply(); }
              }} />
          </label>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={buildMode === "exact" && !build.trim()} onClick={apply}
          className="min-h-11 rounded-md border border-border px-3 text-sm disabled:opacity-50">Apply field filters</button>
        <button type="button" className="min-h-11 rounded-md border border-border px-3 text-sm" onClick={() => {
          setBuildMode("all"); setBuild(""); setCategory(undefined); onApply({});
        }}>Clear field filters</button>
      </div>
      <p className="break-words text-xs text-muted-foreground" role="status" data-testid="field-evidence-population">
        {filters.appBuild !== undefined || filters.deviceCategory !== undefined
          ? `Selected population: ${filters.appBuild === "local" ? "Unknown build (local)" : filters.appBuild ?? "All builds"} · ${filters.deviceCategory ?? "All browser / device categories"}. Counts and recovery use matching observations retained for 30 days.`
          : "Unfiltered: all builds and browser / device categories. Counts and recovery use facility lifetime issues; recent evidence is retained for 30 days."}
        {" "}Advisory only; not release verification evidence. “local” identifies an unknown build, not an environment.
      </p>
    </div>
  );
}
