import { useEffect, useRef, useState } from "react";
import {
  canStartMixedImport, cancelQueuedMixedImports, isSupportedReviewFile,
  MAX_MIXED_IMPORT_FILES, type MixedImportItem, type MixedImportType,
  type MixedImportStatus, type WorkbookFileSelection,
} from "../mixedImportQueue";
import { readPendingImportOperations } from "../importOperations";

export type ImporterReviewState = {
  open: boolean;
  loading?: boolean;
  applying?: boolean;
  error?: string | null;
  progress?: { done: number; total: number } | null;
};
type Options = {
  identity: string;
  enabled: ReadonlySet<string>;
  states: Record<MixedImportType, ImporterReviewState>;
  start: Record<MixedImportType, (event: WorkbookFileSelection) => Promise<void>>;
};

/** Session memory only. This coordinates navigation, never commits or replays writes. */
export function useMixedImportQueue(options: Options) {
  const [items, setItems] = useState<MixedImportItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const active = useRef<string | null>(null);
  const busy = useRef(false);
  const committing = useRef(false);
  const identity = useRef(options.identity);
  const generation = useRef(0);
  const sequence = useRef(0);
  const patch = (id: string, status: MixedImportStatus, detail?: string) =>
    setItems((previous) => previous.map((item) => item.id === id ? { ...item, status, detail } : item));

  useEffect(() => {
    if (identity.current === options.identity) return;
    identity.current = options.identity;
    generation.current++;
    active.current = null;
    busy.current = false;
    committing.current = false;
    setItems([]);
    setMessage(null);
  }, [options.identity]);

  // Importers remain the source of progress and error state. Never interpret
  // a closed dialog as a successful save.
  useEffect(() => {
    const item = items.find((entry) => entry.id === active.current);
    if (!item || busy.current) return;
    const state = options.states[item.type];
    if (!state.open) {
      if (state.loading || state.applying) return;
      if (item.status === "uncertain") return;
      if (item.status !== "failed") patch(item.id, "cancelled", "Review closed. No group rollback was performed.");
      else setItems((previous) => [...previous]);
      active.current = null;
      return;
    }
    const status = state.applying ? "applying" : state.error ? "failed" : state.loading ? "preparing" : "reviewing";
    const detail = state.error || (state.progress ? `${state.progress.done} / ${state.progress.total}` : undefined);
    // Unconfirmed operations may only recover inside their original review.
    if (item.status !== "uncertain" && (item.status !== status || item.detail !== detail)) patch(item.id, status, detail);
  });

  function add(files: readonly File[], type: MixedImportType) {
    if (!options.enabled.has(type)) return;
    const supported = files.filter((file) => isSupportedReviewFile(file.name, type));
    const room = Math.max(0, MAX_MIXED_IMPORT_FILES - items.length);
    setMessage(supported.length !== files.length || supported.length > room
      ? `Only supported files for the selected importer can be added, up to ${MAX_MIXED_IMPORT_FILES} files per review group. Sauce guides use .docx, .doc or .txt; other importers use workbooks. Some files were not added.` : null);
    setItems((previous) => [...previous, ...supported.slice(0, Math.max(0, MAX_MIXED_IMPORT_FILES - previous.length)).map((file) => ({
      id: `review-${++sequence.current}`, file, type, status: "queued" as const,
    }))]);
  }

  async function review(id: string) {
    const item = items.find((entry) => entry.id === id);
    if (!item || !options.enabled.has(item.type) ||
      !canStartMixedImport(item, !!active.current || busy.current) ||
      Object.values(options.states).some((state) => state.open || state.loading || state.applying)) return;
    if (!isSupportedReviewFile(item.file.name, item.type)) {
      setMessage("The selected importer does not support this file format. Sauce guides use .docx, .doc or .txt; choose the correct type before reviewing.");
      return;
    }
    const pending = readPendingImportOperations();
    if (!pending.available || pending.operations.length) {
      setMessage("Resolve the earlier unconfirmed import in its original review before starting another file.");
      return;
    }
    const gen = generation.current;
    active.current = id;
    busy.current = true;
    patch(id, "preparing");
    try {
      await options.start[item.type]({ target: { files: [item.file], value: "" } });
      if (gen !== generation.current) return;
      if (active.current === id) patch(id, "reviewing");
    } catch (error) {
      if (gen !== generation.current) return;
      patch(id, "failed", error instanceof Error ? error.message : "Preparation failed. Nothing was applied.");
      active.current = null;
    } finally {
      if (gen === generation.current) {
        busy.current = false;
        // Trigger reconciliation even if preparation returned without a dialog.
        setItems((previous) => [...previous]);
      }
    }
  }

  function outcome(type: MixedImportType, status: "applied" | "partial" | "failed", detail: string) {
    const item = items.find((entry) => entry.id === active.current && entry.type === type);
    if (!item) return;
    patch(item.id, status, detail);
    active.current = null;
  }

  async function confirm(type: MixedImportType, work: () => Promise<void>) {
    const id = items.find((item) => item.id === active.current && item.type === type)?.id ?? null;
    if (id && committing.current) return;
    const gen = generation.current;
    if (id) { busy.current = true; patch(id, "applying"); }
    if (id) committing.current = true;
    try {
      await work();
    } finally {
      if (id && gen === generation.current) {
        busy.current = false;
        committing.current = false;
        if (active.current === id) {
          const pending = readPendingImportOperations();
          if (!pending.available || pending.operations.length) {
            patch(id, "uncertain", "Save not confirmed. Retry only the original operation in this review; do not prepare a replacement.");
          } else patch(id, "reviewing", "Review remains open. No group success or rollback is implied.");
        }
      }
    }
  }

  return {
    items, message, review, add, outcome, confirm,
    activeId: active.current,
    canCloseReview() {
      if (!active.current) return true;
      const pending = readPendingImportOperations();
      if (committing.current || !pending.available || pending.operations.length) {
        setMessage("Keep the original review open until its save is confirmed. Use its original Apply/retry action; no replacement request was prepared.");
        return false;
      }
      return true;
    },
    blocked: !!active.current || busy.current || Object.values(options.states).some((state) => state.open || state.loading || state.applying),
    setType(id: string, type: MixedImportType) {
      if (!options.enabled.has(type)) return;
      setItems((previous) => previous.map((item) => item.id === id && canStartMixedImport(item, item.id === active.current)
        ? { ...item, type, status: "queued", detail: undefined } : item));
    },
    cancelRemaining() { setItems(cancelQueuedMixedImports); },
    clear() {
      if (!active.current && !busy.current) { setItems([]); setMessage(null); }
    },
  };
}
