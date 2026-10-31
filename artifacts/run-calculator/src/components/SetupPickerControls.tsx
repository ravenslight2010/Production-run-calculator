import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import { TouchOptionPicker } from "./TouchOptionPicker";
import { useDropdownScrollKeeper } from "../hooks/useDropdownScrollKeeper";
import { useIsTouchDevice } from "../hooks/use-mobile";
import { useFactoryDirectoryReady } from "./FactoryDirectoryBoundary";

export function IngredientSelect({
  value,
  onChange,
  options,
  onAddOption,
  onRemoveOption,
  placeholder,
  optionLabels,
  ariaLabel,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  onAddOption?: (v: string) => void;
  onRemoveOption?: (v: string) => void;
  placeholder?: string;
  // Optional display label per option value (e.g. brand tags for colliding
  // recipe names: "Taco Mix (Marco's)"). The VALUE stored stays the bare name.
  optionLabels?: ReadonlyMap<string, string>;
  ariaLabel?: string;
  testId?: string;
}) {
  const directoryReady = useFactoryDirectoryReady();
  const labelOf = (opt: string) => optionLabels?.get(opt) ?? opt;
  const isTouchDevice = useIsTouchDevice();
  const [open, setOpen] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [dropUp, setDropUp] = useState(false);
  const [rect, setRect] = useState<{ top: number; bottom: number; left: number; width: number } | null>(null);
  const confirmDeleteRef = useRef<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const scrollKeep = useDropdownScrollKeeper(open);
  const filtered = (options ?? []).filter(o =>
    labelOf(o).toLowerCase().includes(inputVal.toLowerCase())
  );

  function openDropdown() {
    if (!directoryReady) return;
    setInputVal("");
    setConfirmDelete(null);
    confirmDeleteRef.current = null;
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom;
      const dropdownH = Math.min(filtered.length * 32 + 80, 280);
      setDropUp(spaceBelow < dropdownH && r.top > dropdownH);
      setRect({ top: r.top, bottom: r.bottom, left: r.left, width: r.width });
    }
    setOpen(true);
  }

  const dropStyle: CSSProperties = rect
    ? {
        position: "fixed",
        left: Math.max(4, Math.min(rect.left, window.innerWidth - Math.max(rect.width, 192) - 8)),
        width: Math.max(rect.width, 192),
        zIndex: 9999,
        ...(dropUp
          ? { bottom: window.innerHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
      }
    : {};

  if (isTouchDevice) {
    if (!directoryReady) return <span role="status">Lists unavailable. Retry online.</span>;
    const accessibleLabel = (placeholder ?? "Select option").replace(/[.…]+$/, "").trim();
    return (
      <TouchOptionPicker
        value={value}
        options={(options ?? []).map((option) => ({
          value: option,
          label: labelOf(option),
        }))}
        onValueChange={onChange}
        placeholder={placeholder}
        title={ariaLabel ?? `Select ${accessibleLabel.toLocaleLowerCase()}`}
        aria-label={ariaLabel ?? placeholder ?? accessibleLabel}
        data-testid={testId}
        onAddOption={onAddOption}
        onRemoveOption={onRemoveOption}
      />
    );
  }

  return (
    <div className="relative w-full">
      <button
        ref={triggerRef}
        type="button"
        disabled={!directoryReady}
        title={!directoryReady ? "Operational lists unavailable. Retry online." : undefined}
        onClick={openDropdown}
        aria-label={ariaLabel}
        data-testid={testId}
        className="flex items-center gap-1 h-8 px-2 rounded bg-muted/40 border border-border/40 text-sm hover:bg-muted/70 transition-colors w-full justify-between"
      >
        <span className={`truncate ${value ? "text-foreground" : "text-muted-foreground"}`}>
          {(value && labelOf(value)) || placeholder || "Select…"}
        </span>
        <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
      </button>
      {open && (
        <div
          style={dropStyle}
          className="bg-popover border border-border rounded-md shadow-xl py-1"
        >
          <input
            autoFocus
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && inputVal.trim() && onAddOption) {
                onAddOption(inputVal.trim());
                onChange(inputVal.trim());
                setOpen(false);
              }
              if (e.key === "Escape") setOpen(false);
            }}
            onBlur={() => setTimeout(() => { if (!confirmDeleteRef.current) setOpen(false); }, 150)}
            placeholder="Search or add…"
            className="w-full px-3 py-1.5 text-xs bg-transparent border-b border-border/50 outline-none"
          />
          <div ref={scrollKeep.listRef} onScroll={scrollKeep.onScroll} className="max-h-60 overflow-y-auto overscroll-contain">
            {filtered.map(opt =>
              confirmDelete === opt ? (
                <div key={opt} className="px-3 py-1.5 flex items-center justify-between gap-1 bg-destructive/10">
                  <span className="text-[10px] text-destructive font-semibold truncate">Remove "{opt}"?</span>
                  <span className="flex gap-1 shrink-0">
                    <button type="button" className="px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground text-[10px] font-semibold hover:bg-destructive/80 transition-colors" onMouseDown={() => { onRemoveOption?.(opt); confirmDeleteRef.current = null; setConfirmDelete(null); setOpen(false); }}>Yes</button>
                    <button type="button" className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-semibold hover:bg-muted/80 transition-colors" onMouseDown={() => { confirmDeleteRef.current = null; setConfirmDelete(null); }}>No</button>
                  </span>
                </div>
              ) : (
                <div key={opt} className="flex items-center">
                  <button
                    type="button"
                    className={`flex-1 text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors ${value === opt ? "text-primary font-semibold" : ""}`}
                    onMouseDown={() => { onChange(opt); setOpen(false); }}
                  >
                    {labelOf(opt)}
                  </button>
                  {onRemoveOption && (
                    <button
                      type="button"
                      tabIndex={-1}
                      className="px-2 py-1.5 text-muted-foreground/40 hover:text-destructive transition-colors"
                      onMouseDown={e => { e.stopPropagation(); confirmDeleteRef.current = opt; setConfirmDelete(opt); }}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )
            )}
            {inputVal.trim() && !(options ?? []).includes(inputVal.trim()) && onAddOption && (
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 text-xs text-primary hover:bg-muted transition-colors flex items-center gap-1"
                onMouseDown={() => { onAddOption(inputVal.trim()); onChange(inputVal.trim()); setOpen(false); }}
              >
                <Plus className="w-3 h-3" /> Add "{inputVal.trim()}"
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export type TypeDropdownProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  onAddOption: (v: string) => void;
  onRemoveOption: (v: string) => void;
  allowClear?: boolean;
  ariaLabel?: string;
  testId?: string;
  /**
   * Setup controls render the field label beside the touch picker. Live-run
   * surfaces provide their label in surrounding layout, so they opt out.
   */
  showLabelOnTouch?: boolean;
};

export function TypeDropdown({
  label,
  value,
  onChange,
  options,
  onAddOption,
  onRemoveOption,
  allowClear,
  ariaLabel,
  testId,
  showLabelOnTouch = true,
}: TypeDropdownProps) {
  const directoryReady = useFactoryDirectoryReady();
  const isTouchDevice = useIsTouchDevice();
  const [open, setOpen] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [dropUp, setDropUp] = useState(false);
  const [rect, setRect] = useState<{ top: number; bottom: number; right: number } | null>(null);
  const confirmDeleteRef = useRef<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const scrollKeep = useDropdownScrollKeeper(open);
  const filtered = options.filter(o =>
    o.toLowerCase().includes(inputVal.toLowerCase())
  );

  const MENU_W = 176;
  function openDropdown() {
    if (!directoryReady) return;
    setInputVal("");
    setConfirmDelete(null);
    confirmDeleteRef.current = null;
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom;
      const dropdownH = Math.min(filtered.length * 32 + 80, 240);
      setDropUp(spaceBelow < dropdownH && r.top > dropdownH);
      setRect({ top: r.top, bottom: r.bottom, right: r.right });
    }
    setOpen(true);
  }

  const dropStyle: CSSProperties = rect
    ? {
        position: "fixed",
        left: Math.max(4, Math.min(rect.right - MENU_W, window.innerWidth - MENU_W - 8)),
        width: MENU_W,
        zIndex: 9999,
        ...(dropUp
          ? { bottom: window.innerHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
      }
    : {};

  if (isTouchDevice) {
    if (!directoryReady) return <span role="status">Lists unavailable. Retry online.</span>;
    const touchOptions = [
      ...(allowClear && value ? [{ value: "", label: "— None" }] : []),
      ...options.map((option) => ({ value: option, label: option })),
    ];
    const accessibleLabel = ariaLabel ?? label;
    const picker = (
      <TouchOptionPicker
        value={value}
        options={touchOptions}
        onValueChange={onChange}
        placeholder="Select…"
        title={accessibleLabel}
        aria-label={accessibleLabel}
        data-testid={testId}
        onAddOption={onAddOption}
        onRemoveOption={onRemoveOption}
      />
    );
    if (!showLabelOnTouch) return picker;
    return (
      <div className="flex items-center justify-between mb-2 mt-5 first:mt-0">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </p>
        {picker}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between mb-2 mt-5 first:mt-0">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          onClick={openDropdown}
          disabled={!directoryReady}
          title={!directoryReady ? "Operational lists unavailable. Retry online." : undefined}
          aria-label={ariaLabel ?? label}
          data-testid={testId}
          className="flex items-center gap-1 px-2 py-0.5 rounded bg-muted/40 border border-border/40 text-xs font-semibold hover:bg-muted/70 transition-colors min-w-[110px] justify-between"
        >
          <span className={value ? "text-foreground" : "text-muted-foreground/50"}>
            {value || "Select…"}
          </span>
          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
        </button>
        {open && (
          <div
            style={dropStyle}
            className="bg-popover border border-border rounded-md shadow-lg py-1"
          >
            <input
              autoFocus
              value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && inputVal.trim()) {
                  onAddOption(inputVal.trim());
                  onChange(inputVal.trim());
                  setOpen(false);
                }
                if (e.key === "Escape") setOpen(false);
              }}
              onBlur={() => setTimeout(() => { if (!confirmDeleteRef.current) setOpen(false); }, 150)}
              placeholder="Search or add…"
              className="w-full px-3 py-1.5 text-xs bg-transparent border-b border-border/50 outline-none"
            />
            <div ref={scrollKeep.listRef} onScroll={scrollKeep.onScroll} className="max-h-48 overflow-y-auto overscroll-contain">
              {allowClear && value && (
                <button
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors italic"
                  onMouseDown={() => { onChange(""); setOpen(false); }}
                >
                  — None
                </button>
              )}
              {filtered.map(opt =>
                confirmDelete === opt ? (
                  <div key={opt} className="px-3 py-1.5 flex items-center justify-between gap-1 bg-destructive/10">
                    <span className="text-[10px] text-destructive font-semibold truncate">Remove "{opt}"?</span>
                    <span className="flex gap-1 shrink-0">
                      <button type="button" className="px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground text-[10px] font-semibold hover:bg-destructive/80 transition-colors" onMouseDown={() => { onRemoveOption?.(opt); confirmDeleteRef.current = null; setConfirmDelete(null); setOpen(false); }}>Yes</button>
                      <button type="button" className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-semibold hover:bg-muted/80 transition-colors" onMouseDown={() => { confirmDeleteRef.current = null; setConfirmDelete(null); }}>No</button>
                    </span>
                  </div>
                ) : (
                  <div key={opt} className="flex items-center">
                    <button
                      type="button"
                      className={`flex-1 text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors ${value === opt ? "text-primary font-semibold" : ""}`}
                      onMouseDown={() => { onChange(opt); setOpen(false); }}
                    >
                      {opt}
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      className="px-2 py-1.5 text-muted-foreground/40 hover:text-destructive transition-colors"
                      onMouseDown={e => { e.stopPropagation(); confirmDeleteRef.current = opt; setConfirmDelete(opt); }}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )
              )}
              {inputVal.trim() && !options.includes(inputVal.trim()) && (
                <button
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-xs text-primary hover:bg-muted transition-colors flex items-center gap-1"
                  onMouseDown={() => { onAddOption(inputVal.trim()); onChange(inputVal.trim()); setOpen(false); }}
                >
                  <Plus className="w-3 h-3" /> Add "{inputVal.trim()}"
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
