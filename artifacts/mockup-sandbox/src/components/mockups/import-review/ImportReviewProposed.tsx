import { useState } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  Wand2,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  Scale,
} from "lucide-react";

const AMBER = "#FF9500";

type BlendRow = { name: string; lbs: number; share: number };

const BLEND: BlendRow[] = [
  { name: "Pizella", lbs: 340, share: 0.568 },
  { name: "Part Skim Mozzarella", lbs: 195, share: 0.326 },
  { name: "Grated Parmesan", lbs: 42, share: 0.07 },
  { name: "Oregano Flake", lbs: 21, share: 0.035 },
];

const FLAVORS = [
  { flavor: "CHEESE", target: 4.5 },
  { flavor: "PEPPERONI", target: 4.0 },
  { flavor: "SAUSAGE & PEPPERONI", target: 3.75 },
  { flavor: "MEAT LOVER", target: 3.5 },
  { flavor: "SAUSAGE", target: 4.0 },
];

function NameFix({
  label,
  imported,
  cleaned,
}: {
  label: string;
  imported: string;
  cleaned: string;
}) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Wand2 className="h-4 w-4" style={{ color: AMBER }} />
        <span className="text-xs font-semibold uppercase tracking-wide text-amber-700">
          {label} name cleanup
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-white px-2 py-1 font-mono text-sm text-gray-500 line-through decoration-red-400">
          {imported}
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-gray-400" />
        <span
          className="rounded px-2 py-1 font-mono text-sm font-semibold text-white"
          style={{ backgroundColor: AMBER }}
        >
          {cleaned}
        </span>
      </div>
      <p className="mt-2 text-xs text-gray-600">
        Extra descriptors like sizes, die notes, and "(made in house)" are
        dropped so the name matches your existing recipe.
      </p>
    </div>
  );
}

export function ImportReviewProposed() {
  const [openFlavor, setOpenFlavor] = useState<string | null>("CHEESE");

  return (
    <div className="min-h-screen bg-gray-50 p-6 font-sans">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-6 w-6" style={{ color: AMBER }} />
              <h1 className="text-2xl font-bold text-gray-900">
                Review Import — Aldo's Spec Sheet
              </h1>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Nothing is saved until you confirm. Fix anything that looks wrong
              below.
            </p>
          </div>
          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
            5 flavors found
          </span>
        </div>

        {/* Name cleanups */}
        <div className="grid gap-4 md:grid-cols-2">
          <NameFix
            label="Sauce"
            imported="Aldo's Sauce (made in house)"
            cleaned="Aldo's Sauce"
          />
          <NameFix
            label="Dough"
            imported={'Parbake crust (Aldo\u2019s recipe 12" Dies)'}
            cleaned="Aldo's recipe"
          />
        </div>

        {/* Cheese blend */}
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 p-4">
            <div className="flex items-center gap-2">
              <Scale className="h-5 w-5" style={{ color: AMBER }} />
              <h2 className="text-lg font-semibold text-gray-900">
                Cheese Mix — blend ratios
              </h2>
            </div>
            <p className="mt-1 text-sm text-gray-600">
              The batch recipe defines each ingredient's <b>share</b> of the
              blend. Per-pizza ounces are then computed <b>per flavor</b> from
              that flavor's cheese target weight — no more one-size-fits-all
              numbers.
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2">Ingredient</th>
                <th className="px-4 py-2 text-right">Batch lbs</th>
                <th className="px-4 py-2 text-right">Share of blend</th>
              </tr>
            </thead>
            <tbody>
              {BLEND.map((r) => (
                <tr key={r.name} className="border-t border-gray-100">
                  <td className="px-4 py-2 font-medium text-gray-900">
                    {r.name}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-gray-700">
                    {r.lbs}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="h-2 rounded-full"
                        style={{
                          width: `${Math.max(8, r.share * 120)}px`,
                          backgroundColor: AMBER,
                          opacity: 0.4 + r.share,
                        }}
                      />
                      <span className="font-mono font-semibold text-gray-900">
                        {(r.share * 100).toFixed(1)}%
                      </span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Per-flavor breakdown */}
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 p-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Per-flavor cheese ounces (preview)
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              ingredient oz/pizza = flavor's cheese target weight × ingredient's
              share of the blend
            </p>
          </div>
          <div className="divide-y divide-gray-100">
            {FLAVORS.map((f) => {
              const open = openFlavor === f.flavor;
              return (
                <div key={f.flavor}>
                  <button
                    className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
                    onClick={() => setOpenFlavor(open ? null : f.flavor)}
                  >
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      <span className="font-semibold text-gray-900">
                        {f.flavor}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-500">
                        cheese target:{" "}
                        <span className="font-mono font-semibold text-gray-900">
                          {f.target.toFixed(2)} oz
                        </span>
                      </span>
                      {open ? (
                        <ChevronUp className="h-4 w-4 text-gray-400" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-gray-400" />
                      )}
                    </div>
                  </button>
                  {open && (
                    <div className="bg-gray-50/70 px-4 pb-4">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                            <th className="py-1.5">Ingredient</th>
                            <th className="py-1.5 text-right">Share</th>
                            <th className="py-1.5 text-right">oz / pizza</th>
                          </tr>
                        </thead>
                        <tbody>
                          {BLEND.map((r) => (
                            <tr key={r.name} className="border-t border-gray-200/70">
                              <td className="py-1.5 text-gray-800">{r.name}</td>
                              <td className="py-1.5 text-right font-mono text-gray-500">
                                {(r.share * 100).toFixed(1)}%
                              </td>
                              <td className="py-1.5 text-right font-mono font-semibold text-gray-900">
                                {(f.target * r.share).toFixed(3)}
                              </td>
                            </tr>
                          ))}
                          <tr className="border-t-2 border-gray-300">
                            <td className="py-1.5 font-semibold text-gray-900">
                              Total
                            </td>
                            <td />
                            <td className="py-1.5 text-right font-mono font-bold" style={{ color: AMBER }}>
                              {f.target.toFixed(3)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Old behavior warning */}
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
          <div className="text-sm text-red-800">
            <b>What the import used to get wrong:</b> one fixed oz/pizza number
            was applied to every flavor, and sauce/dough names kept extra text
            like "(made in house)" and die sizes, creating duplicate recipes
            instead of matching your existing ones.
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-3 pb-4">
          <button className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button
            className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white shadow-sm"
            style={{ backgroundColor: AMBER }}
          >
            Confirm Import
          </button>
        </div>
      </div>
    </div>
  );
}
