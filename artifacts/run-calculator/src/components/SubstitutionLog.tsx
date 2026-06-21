import { History, PlusCircle, MinusCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SubstitutionLogEntry } from "@workspace/inventory-math";

// Read-only timestamped trail of today's substitution add/clear actions, for
// shift handoffs and end-of-day review. Newest first. Auto-clears at the daily
// reset alongside the substitutions themselves.
export default function SubstitutionLog({
  entries,
}: {
  entries: SubstitutionLogEntry[];
}) {
  if (!entries || entries.length === 0) return null;
  const ordered = [...entries].sort((a, b) => b.ts - a.ts);
  return (
    <Card className="bg-card/50 border-border/50 shadow-md">
      <CardHeader className="pb-2 pt-4 px-5">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <History className="w-4 h-4" /> Today's Substitutions
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-1.5">
        {ordered.map((e) => (
          <div
            key={e.id}
            className="flex items-start gap-2 px-3 py-2 rounded-md bg-muted/40 border border-border/40 text-sm"
          >
            {e.kind === "added" ? (
              <PlusCircle className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <MinusCircle className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-foreground truncate">{e.description}</p>
              <p className="text-xs text-muted-foreground">
                {e.kind === "added" ? "Added" : "Cleared"} · {fmtLogTime(e.ts)}
                {e.user ? ` · ${e.user}` : ""}
              </p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function fmtLogTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
