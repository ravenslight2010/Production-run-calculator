import { useEffect, useState } from "react";
import { Snowflake } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchMixes } from "../mixes";
import type { Mix } from "@workspace/mixes";

// Surplus Mix reminder card for the Warehouse tab (Feature B2).
// Self-contained: fetches the server-persisted mixes and lists any that have
// pre-made ("Already made") mix in the freezer, so the next run knows what's
// available before making fresh. Read-only — managers edit amounts in the
// Mixes tab.
export default function SurplusMixCard() {
  const [mixes, setMixes] = useState<Mix[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setMixes(await fetchMixes());
      } catch {
        /* hide card on load failure */
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  if (!loaded) return null;
  const surplus = mixes
    .filter((m) => m.enabled && (m.amountAlreadyMade ?? 0) > 0)
    .sort((a, b) => b.amountAlreadyMade - a.amountAlreadyMade);
  if (surplus.length === 0) return null;

  return (
    <Card
      className="bg-sky-950/30 border-sky-700/40 shadow-md mb-4"
      data-testid="surplus-mix-card"
    >
      <CardHeader className="pb-2 pt-4 px-5">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-sky-300 flex items-center gap-1.5">
          <Snowflake className="w-4 h-4" /> Mix in Freezer
          <span className="ml-1 font-normal normal-case text-xs text-sky-400/80">
            ({surplus.length} mix{surplus.length !== 1 ? "es" : ""})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-1">
        {surplus.map((m) => (
          <div
            key={m.id}
            className="flex items-baseline justify-between gap-2 text-sm"
            data-testid={`surplus-mix-${m.id}`}
          >
            <span className="text-sky-200/90 truncate">
              {m.name}
              <span className="ml-1.5 text-[11px] text-sky-400/70">
                {m.brand}
                {m.flavor ? ` — ${m.flavor}` : ""}
              </span>
            </span>
            <span className="font-bold tabular-nums whitespace-nowrap text-sky-50">
              {m.amountAlreadyMade}{" "}
              <span className="font-normal text-sky-300/80">lbs on hand</span>
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
