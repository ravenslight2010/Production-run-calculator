import { useRef, useState } from "react";
import type { ImportParseResult } from "../utils/runExcel";
import type { SpecImportPrepared } from "../specImport";
import type { PremixImportPrepared } from "../premixImport";
import type { ShippingImportPrepared } from "../shippingImport";
import type { SauceGuideImportPrepared, DoughGuideImportPrepared } from "../recipeGuideImport";
import type { CheeseImportPrepared } from "../cheeseImport";

type Progress = { done: number; total: number } | null;

/** Executes only the first open import-dialog close command. */
export function closeTopmostImportDialog(
  commands: ReadonlyArray<{ open: boolean; close: () => void }>,
): boolean {
  const command = commands.find(({ open }) => open);
  if (!command) return false;
  command.close();
  return true;
}

/**
 * State containers for Home's deferred workbook/import surfaces. It owns no
 * parsing or loaders: Home keeps render-time DeferredSurface conditions and
 * loader functions unchanged, preserving chunk boundaries.
 */
export function useHomeImportDialogs() {
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importResult, setImportResult] = useState<ImportParseResult | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const scheduleImportInputRef = useRef<HTMLInputElement | null>(null);
  const [showSpecImport, setShowSpecImport] = useState(false);
  const [specImportLoading, setSpecImportLoading] = useState(false);
  const [specImportApplying, setSpecImportApplying] = useState(false);
  const [specImportError, setSpecImportError] = useState<string | null>(null);
  const [specImportPrepared, setSpecImportPrepared] = useState<SpecImportPrepared | null>(null);
  const [specImportProgress, setSpecImportProgress] = useState<Progress>(null);
  const specImportInputRef = useRef<HTMLInputElement | null>(null);
  const [showPremixImport, setShowPremixImport] = useState(false);
  const [premixImportLoading, setPremixImportLoading] = useState(false);
  const [premixImportApplying, setPremixImportApplying] = useState(false);
  const [premixImportError, setPremixImportError] = useState<string | null>(null);
  const [premixImportPrepared, setPremixImportPrepared] = useState<PremixImportPrepared | null>(null);
  const [premixImportProgress, setPremixImportProgress] = useState<Progress>(null);
  const premixImportInputRef = useRef<HTMLInputElement | null>(null);
  const [showShippingImport, setShowShippingImport] = useState(false);
  const [shippingImportLoading, setShippingImportLoading] = useState(false);
  const [shippingImportApplying, setShippingImportApplying] = useState(false);
  const [shippingImportError, setShippingImportError] = useState<string | null>(null);
  const [shippingImportPrepared, setShippingImportPrepared] = useState<ShippingImportPrepared | null>(null);
  const shippingImportInputRef = useRef<HTMLInputElement | null>(null);
  const [showSauceGuideImport, setShowSauceGuideImport] = useState(false);
  const [sauceGuideImportLoading, setSauceGuideImportLoading] = useState(false);
  const [sauceGuideImportApplying, setSauceGuideImportApplying] = useState(false);
  const [sauceGuideImportError, setSauceGuideImportError] = useState<string | null>(null);
  const [sauceGuideImportPrepared, setSauceGuideImportPrepared] = useState<SauceGuideImportPrepared | null>(null);
  const sauceGuideImportInputRef = useRef<HTMLInputElement | null>(null);
  const [showDoughGuideImport, setShowDoughGuideImport] = useState(false);
  const [doughGuideImportLoading, setDoughGuideImportLoading] = useState(false);
  const [doughGuideImportApplying, setDoughGuideImportApplying] = useState(false);
  const [doughGuideImportError, setDoughGuideImportError] = useState<string | null>(null);
  const [doughGuideImportPrepared, setDoughGuideImportPrepared] = useState<DoughGuideImportPrepared | null>(null);
  const doughGuideImportInputRef = useRef<HTMLInputElement | null>(null);
  const [showCheeseImport, setShowCheeseImport] = useState(false);
  const [cheeseImportLoading, setCheeseImportLoading] = useState(false);
  const [cheeseImportApplying, setCheeseImportApplying] = useState(false);
  const [cheeseImportError, setCheeseImportError] = useState<string | null>(null);
  const [cheeseImportPrepared, setCheeseImportPrepared] = useState<CheeseImportPrepared | null>(null);
  const [cheeseImportProgress, setCheeseImportProgress] = useState<Progress>(null);
  const cheeseImportInputRef = useRef<HTMLInputElement | null>(null);
  return {
    showImportDialog, setShowImportDialog, importResult, setImportResult, importInputRef, scheduleImportInputRef,
    showSpecImport, setShowSpecImport, specImportLoading, setSpecImportLoading, specImportApplying, setSpecImportApplying, specImportError, setSpecImportError, specImportPrepared, setSpecImportPrepared, specImportProgress, setSpecImportProgress, specImportInputRef,
    showPremixImport, setShowPremixImport, premixImportLoading, setPremixImportLoading, premixImportApplying, setPremixImportApplying, premixImportError, setPremixImportError, premixImportPrepared, setPremixImportPrepared, premixImportProgress, setPremixImportProgress, premixImportInputRef,
    showShippingImport, setShowShippingImport, shippingImportLoading, setShippingImportLoading, shippingImportApplying, setShippingImportApplying, shippingImportError, setShippingImportError, shippingImportPrepared, setShippingImportPrepared, shippingImportInputRef,
    showSauceGuideImport, setShowSauceGuideImport, sauceGuideImportLoading, setSauceGuideImportLoading, sauceGuideImportApplying, setSauceGuideImportApplying, sauceGuideImportError, setSauceGuideImportError, sauceGuideImportPrepared, setSauceGuideImportPrepared, sauceGuideImportInputRef,
    showDoughGuideImport, setShowDoughGuideImport, doughGuideImportLoading, setDoughGuideImportLoading, doughGuideImportApplying, setDoughGuideImportApplying, doughGuideImportError, setDoughGuideImportError, doughGuideImportPrepared, setDoughGuideImportPrepared, doughGuideImportInputRef,
    showCheeseImport, setShowCheeseImport, cheeseImportLoading, setCheeseImportLoading, cheeseImportApplying, setCheeseImportApplying, cheeseImportError, setCheeseImportError, cheeseImportPrepared, setCheeseImportPrepared, cheeseImportProgress, setCheeseImportProgress, cheeseImportInputRef,
  };
}