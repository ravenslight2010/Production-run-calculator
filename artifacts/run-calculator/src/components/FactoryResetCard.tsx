import { useState } from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Manager-only "Danger zone" card: full factory data reset. Calls
// POST /api/sync/purge-all which, in one server transaction, wipes ALL shared
// data (day-state, profiles, recipes, mixes, ingredients, inventory, saved
// import sheets, learned aliases, AI memory, incidents, rules, templates,
// settings) while keeping every user account and role. The server bumps the
// reset epoch and broadcasts it, so every open device wipes its local copy and
// reloads automatically — including this one.
export default function FactoryResetCard() {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const armed = confirmText.trim().toUpperCase() === "RESET";

  const runPurge = async () => {
    if (!armed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sync/purge-all", { method: "POST" });
      if (!res.ok) {
        let msg = `Reset failed (${res.status})`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) msg = body.error;
        } catch {}
        throw new Error(msg);
      }
      // The SSE reset broadcast + epoch guard will wipe local storage and
      // reload this tab; force a reload as a belt-and-braces fallback so the
      // manager always lands on a clean slate immediately.
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed");
      setBusy(false);
    }
  };

  return (
    <Card className="border-destructive/40">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" /> Danger zone
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Erase ALL factory data — runs, schedules, profiles, recipes, mixes,
          ingredients, inventory, imported sheets, AI memory, and incidents —
          for a completely fresh start. Staff accounts, roles, and passwords
          are kept. Every signed-in device is wiped and reloaded automatically.
          This cannot be undone.
        </p>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => {
            setConfirmText("");
            setError(null);
            setOpen(true);
          }}
          data-testid="button-factory-reset"
        >
          <Trash2 className="h-4 w-4 mr-1.5" /> Erase all data…
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={(v) => { if (!busy) setOpen(v); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-destructive">Erase all factory data?</DialogTitle>
            <DialogDescription>
              This permanently deletes every run, schedule, recipe, profile,
              inventory record, imported sheet, and AI memory for the whole
              facility. Staff accounts are kept. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Type <span className="font-bold text-foreground">RESET</span> to confirm:
            </p>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="RESET"
              autoFocus
              data-testid="input-factory-reset-confirm"
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={!armed || busy}
              onClick={runPurge}
              data-testid="button-factory-reset-confirm"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
              Erase everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
