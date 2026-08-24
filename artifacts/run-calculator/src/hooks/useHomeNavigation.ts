import { useCallback, useEffect, useRef, useState } from "react";
import { recordPerformance } from "../performanceDiagnostics";

export const ACTIVE_TAB_STORAGE_KEY = "run-calc-active-tab";

export const HOME_TABS = [
  "run",
  "setup",
  "dough",
  "sauce",
  "frontline",
  "packaging",
  "warehouse",
  "inventory",
  "mixes",
  "ai",
  "incidents",
  "downtime",
  "quality",
  "staff",
  "stoppages",
  "summary",
] as const;

export type HomeTab = (typeof HOME_TABS)[number];

const VALID_TABS = new Set<string>(HOME_TABS);

function loadHashTab(): HomeTab | null {
  if (typeof window === "undefined") return null;
  return /^#incidents(?:\/|$)/.test(window.location.hash) ? "incidents" : null;
}

function loadInitialTab(): HomeTab {
  const hashTab = loadHashTab();
  if (hashTab) return hashTab;
  try {
    const saved = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    return saved && VALID_TABS.has(saved) ? (saved as HomeTab) : "run";
  } catch {
    return "run";
  }
}

/**
 * Owns navigation-only state for Home.
 *
 * Run identity remains owned by Home's day-state coordinator. This hook only
 * remembers the selected tab and the tab history used by the back-button trap;
 * station panels should receive navigation callbacks rather than reaching into
 * persistence or sync state.
 */
export function useHomeNavigation() {
  const [activeTab, setActiveTab] = useState<HomeTab>(loadInitialTab);
  const activeTabRef = useRef(activeTab);
  const tabHistoryRef = useRef<HomeTab[]>([]);
  const prevTabRef = useRef<HomeTab>(activeTab);
  const skipHistoryRef = useRef(false);
  const navigationStartedAtRef = useRef<number | null>(null);

  useEffect(() => {
    const hashTab = loadHashTab();
    if (!hashTab || hashTab === activeTabRef.current) return;
    skipHistoryRef.current = true;
    activeTabRef.current = hashTab;
    setActiveTab(hashTab);
  }, []);

  useEffect(() => {
    if (typeof performance === "undefined") return;
    const startedAt = navigationStartedAtRef.current;
    if (startedAt !== null) {
      const durationMs = performance.now() - startedAt;
      recordPerformance(`tab:${activeTab}`, durationMs, "navigation");
      recordPerformance(`tab-render:${activeTab}`, durationMs, "render");
      navigationStartedAtRef.current = null;
    }
  }, [activeTab]);

  const selectTab = useCallback((tab: HomeTab) => {
    if (tab === activeTabRef.current) return;
    navigationStartedAtRef.current = typeof performance === "undefined" ? null : performance.now();
    activeTabRef.current = tab;
    setActiveTab(tab);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTab);
    } catch {
      // Losing tab restore is safe when storage is unavailable/full.
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === prevTabRef.current) return;
    if (skipHistoryRef.current) {
      skipHistoryRef.current = false;
      prevTabRef.current = activeTab;
      return;
    }
    tabHistoryRef.current.push(prevTabRef.current);
    if (tabHistoryRef.current.length > 20) tabHistoryRef.current.shift();
    prevTabRef.current = activeTab;
  }, [activeTab]);

  function goBack(): void {
    const previousTab = tabHistoryRef.current.pop();
    if (!previousTab) return;
    skipHistoryRef.current = true;
    selectTab(previousTab);
  }

  return { activeTab, setActiveTab: selectTab, goBack, tabHistoryRef };
}