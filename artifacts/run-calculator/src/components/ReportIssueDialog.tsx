import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { LifeBuoy, Loader2, AlertTriangle, History } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  InventoryApiError,
  reportIncident,
  type IncidentDiagnosis,
} from "../inventoryShared";
import { WEB_BUILD_ID } from "../buildIdentity";

function serverMessage(error: unknown, fallback: string): string {
  return error instanceof InventoryApiError && error.serverMessage
    ? error.serverMessage
    : fallback;
}

// Any signed-in user can describe a problem for manager review. Generated
// diagnosis was retired; `screen` records where the user was when they reported it.
export default function ReportIssueDialog({
  open,
  onOpenChange,
  screen,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  screen: string;
}) {
  const [description, setDescription] = useState("");
  const [result, setResult] = useState<IncidentDiagnosis | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      reportIncident({
        source: "user_report",
        screen,
        appPlatform: "web",
        appVersion: WEB_BUILD_ID,
        description: description.trim(),
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      }),
    onSuccess: (data) => setResult(data),
  });

  function reset() {
    setDescription("");
    setResult(null);
    mutation.reset();
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  const canSubmit = description.trim().length > 0 && !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LifeBuoy className="w-5 h-5 text-primary" /> Report an issue
          </DialogTitle>
          <DialogDescription>
            {result
              ? "Your report was recorded for manager review."
              : "Describe what went wrong. Your report will be sent to a manager for review."}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            {result.recurrence ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-300">
                  <History className="w-4 h-4" />
                  {result.recurrence.count > 1
                    ? `Seen ${result.recurrence.count}× before`
                    : "Seen before"}
                </div>
                <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">
                  {result.recurrence.lastWorkaround
                    ? `Last time this helped: ${result.recurrence.lastWorkaround}`
                    : "This kind of problem has come up before."}
                </p>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              No automated diagnosis was generated. Add any immediate workaround you discover to the incident notes.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. I tapped Save on the run and nothing happened…"
              rows={5}
              autoFocus
            />
            {mutation.isError && (
              <p className="flex items-center gap-2 text-sm text-red-400">
                <AlertTriangle className="w-4 h-4" />
                {serverMessage(mutation.error, "Couldn't send your report. Please try again.")}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <>
              <Button variant="outline" onClick={reset}>
                Report another
              </Button>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => mutation.mutate()} disabled={!canSubmit}>
                {mutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Diagnosing…
                  </>
                ) : (
                  "Get help"
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
