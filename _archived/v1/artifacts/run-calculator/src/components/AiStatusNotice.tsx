import { Sparkles } from "lucide-react";
import type { AiStatus } from "../aiStatus";

/**
 * Small advisory notice for responses where the deterministic work completed
 * but optional AI enrichment was unavailable. It intentionally does not render
 * for deterministic or enriched responses.
 */
export default function AiStatusNotice({
  status,
  feature = "AI enhancement",
}: {
  status?: AiStatus;
  feature?: string;
}) {
  if (status !== "unavailable") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="ai-status-unavailable"
      className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
    >
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{feature} unavailable. Deterministic results are still available.</span>
    </div>
  );
}