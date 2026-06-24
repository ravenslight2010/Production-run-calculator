import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Plus, Trash2, ClipboardCheck } from "lucide-react";
import {
  DEFAULT_CADENCE_DAYS,
  type CycleCountSchedule,
} from "@workspace/cycle-count";
import { useCycleCountSchedules } from "../hooks/useCycleCountSchedules";
import {
  saveCycleCountSchedules,
  deleteCycleCountSchedules,
} from "../cycleCount";

function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Manager-only editor for factory-wide cycle-count schedules. Each schedule
// names a warehouse section that must be counted every `cadenceDays` days
// (default 7). Schedules are persisted server-side (shared across all signed-in
// users) and drive the "Time to Count" card on the Warehouse tab. The server
// enforces the manager role on writes; this card is only rendered for managers.
//
// `suggestions` are existing section/area names (e.g. stock-location names) so a
// manager can add a known section in one tap instead of retyping it.
export default function CycleCountManager({
  suggestions = [],
}: {
  suggestions?: string[];
}) {
  const qc = useQueryClient();
  const { schedules, isLoading } = useCycleCountSchedules();
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  // Sections already scheduled (case-insensitive) so the quick-add list only
  // offers ones that aren't already configured.
  const scheduled = useMemo(
    () => new Set(schedules.map((s) => s.section.trim().toLowerCase())),
    [schedules],
  );
  const quickAdd = useMemo(
    () =>
      Array.from(new Set(suggestions.map((s) => s.trim()).filter(Boolean)))
        .filter((s) => !scheduled.has(s.toLowerCase()))
        .sort((a, b) => a.localeCompare(b)),
    [suggestions, scheduled],
  );

  const saveMutation = useMutation({
    mutationFn: (next: CycleCountSchedule[]) => saveCycleCountSchedules(next),
    onSuccess: (saved) => {
      qc.setQueryData(["cycleCountSchedules"], saved);
      setError(null);
    },
    onError: () =>
      setError("Could not save the schedule. Check your connection and try again."),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => deleteCycleCountSchedules(ids),
    onSuccess: (saved) => {
      qc.setQueryData(["cycleCountSchedules"], saved);
      setError(null);
    },
    onError: () =>
      setError("Could not delete the schedule. Check your connection and try again."),
  });

  const busy = saveMutation.isPending || deleteMutation.isPending;

  function addSchedule(section: string) {
    const name = section.trim();
    if (!name) return;
    if (scheduled.has(name.toLowerCase())) {
      setNewName("");
      return;
    }
    saveMutation.mutate([
      {
        id: genId(),
        section: name,
        cadenceDays: DEFAULT_CADENCE_DAYS,
        lastCountedAt: null,
        enabled: true,
      },
    ]);
    setNewName("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="w-4 h-4" />
          Cycle-Count Schedules
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Schedule warehouse sections for regular inventory counts. Each section
          is counted every{" "}
          <span className="font-semibold text-sky-300">N days</span> (default{" "}
          {DEFAULT_CADENCE_DAYS}). The Warehouse tab shows a "Time to Count" card
          once a section is due.
        </p>

        {error && (
          <div className="flex items-start gap-2 px-2.5 py-1.5 rounded-md text-xs border bg-red-950/40 border-red-700/40 text-red-300">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading schedules…</p>
        ) : schedules.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No cycle-count schedules yet. Add one below.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {schedules.map((schedule) => (
              <ScheduleEditor
                key={schedule.id}
                schedule={schedule}
                disabled={busy}
                onChange={(next) => saveMutation.mutate([next])}
                onDelete={() => deleteMutation.mutate([schedule.id])}
              />
            ))}
          </div>
        )}

        {/* Add by typing, with existing section names as suggestions. */}
        <div className="flex items-center gap-2 pt-1 border-t border-border/40">
          <input
            type="text"
            list="cycle-count-suggestions"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addSchedule(newName)}
            placeholder="Section name…"
            disabled={busy}
            className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs"
          />
          <datalist id="cycle-count-suggestions">
            {quickAdd.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <button
            type="button"
            onClick={() => addSchedule(newName)}
            disabled={busy || !newName.trim()}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>

        {/* One-tap add from existing section/location names. */}
        {quickAdd.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold text-muted-foreground">
              Add from existing sections
            </p>
            <div className="flex flex-wrap gap-1.5">
              {quickAdd.slice(0, 30).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => addSchedule(s)}
                  disabled={busy}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-border/60 bg-muted/30 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50"
                >
                  <Plus className="w-3 h-3" /> {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScheduleEditor({
  schedule,
  disabled,
  onChange,
  onDelete,
}: {
  schedule: CycleCountSchedule;
  disabled: boolean;
  onChange: (schedule: CycleCountSchedule) => void;
  onDelete: () => void;
}) {
  function patch(p: Partial<CycleCountSchedule>) {
    onChange({ ...schedule, ...p });
  }

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-2.5 flex flex-wrap items-center gap-2">
      <input
        type="text"
        value={schedule.section}
        onChange={(e) => patch({ section: e.target.value })}
        disabled={disabled}
        className="flex-1 min-w-[8rem] rounded-md border border-input bg-background px-2 py-1 text-xs font-semibold"
      />
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span>every</span>
        <input
          type="number"
          min={1}
          value={schedule.cadenceDays}
          onChange={(e) =>
            patch({ cadenceDays: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })
          }
          disabled={disabled}
          className="w-14 rounded-md border border-input bg-background px-2 py-1 text-xs font-mono"
        />
        <span>days</span>
      </div>
      <span className="text-[11px] text-muted-foreground">
        {schedule.lastCountedAt
          ? `Last counted ${schedule.lastCountedAt}`
          : "Never counted"}
      </span>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={schedule.enabled}
          onChange={(e) => patch({ enabled: e.target.checked })}
          disabled={disabled}
        />
        On
      </label>
      <button
        type="button"
        onClick={onDelete}
        disabled={disabled}
        title="Delete schedule"
        className="p-1 rounded-md text-red-400 hover:bg-red-950/40 disabled:opacity-50"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
