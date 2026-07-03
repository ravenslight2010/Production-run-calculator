import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as Haptics from "expo-haptics";
import { Stack } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CardSection, SectionHeader } from "@/components/UI";
import * as XLSX from "xlsx";
import SpecImportModal from "@/components/SpecImportModal";
import PremixImportModal from "@/components/PremixImportModal";
import ExcelImportModal, { type ImportCommit } from "@/components/ExcelImportModal";
import ProductionRulesManager from "@/components/ProductionRulesManager";
import FreezerPullItemsManager from "@/components/FreezerPullItemsManager";
import MixesManager from "@/components/MixesManager";
import MixReconcilePanel from "@/components/MixReconcilePanel";
import MixAssistChat from "@/components/MixAssistChat";
import CycleCountManager from "@/components/CycleCountManager";
import { DEFAULT_CYCLE_COUNT_SECTIONS } from "@workspace/cycle-count";
import StaffRolesCard from "@/components/StaffRolesCard";
import RolesManager from "@/components/RolesManager";
import {
  profileKey,
  todayStr,
  useRun,
  type MasterListKey,
  type MasterDataChange,
  type RunSettings,
} from "@/context/RunContext";
import {
  parseRunWorkbookBase64,
  parseWorkbookObject,
  filterImportFromDate,
  skipAlreadyRanRuns,
  type ImportParseResult,
} from "@/utils/runExcel";
import { showConfirm, showNote } from "@/utils/notify";
import {
  buildCaseUpdateOffers,
  promptCaseUpdates,
  type CaseUpdateOffer,
} from "@/utils/importCaseUpdates";
import { useDevTestImport } from "@/utils/devTestImport";
import {
  buildMergeMap,
  countMergeReferences,
  type MergeMap,
} from "@/context/mergeIngredients";
import { scoreNameMatch } from "@/context/inventoryShared";
import { suggestMerges, saveMergeAliases, denyMerge, type ReviewedMergeSuggestion, type MergeSuggestCategory } from "@/context/mergeSuggest";
import { collectMergeAliases } from "@workspace/merge-suggest";
import ReviewBadge from "@/components/ReviewBadge";
import {
  prepareSpecImport,
  prepareSpecImportMulti,
  commitSpecImport,
  readWorkbookGridsFromArrayBuffer,
  readWorkbookGridsFromBase64,
  MAX_SPEC_IMPORT_FILES,
  type SpecImportPrepared,
  type SpecImportStore,
} from "@/context/specImport";
import {
  preparePremixImport,
  commitPremixImport,
  MAX_PREMIX_IMPORT_FILES,
  type PremixImportPrepared,
  type PremixImportStore,
} from "@/context/premixImport";
import type { PremixFreezerPull } from "@workspace/premix-import";
import type { Mix } from "@workspace/mixes";
import {
  fetchSavedSpecSheets,
  reconcileSpecSheet,
  deleteSpecSheet,
  presetMapsToReconcileRecipes,
  type SavedSpecSheet,
  type SpecReconcileResult,
} from "@/context/savedSpecSheets";
import {
  reconcileSpecWithRecipes,
  toReconcileRecipes,
  type Discrepancy,
  type ReconcileKind,
  type ReconcileRecipe,
} from "@workspace/spec-reconcile";
import { useColors } from "@/hooks/useColors";
import { useMe } from "@/hooks/useRole";
import { useQueryClient } from "@tanstack/react-query";
import { FONTS } from "@/constants/fonts";
import type { ParsedRecipe } from "@workspace/spec-import";

function tap() {
  Haptics.selectionAsync();
}

function ListManager({
  items,
  onAdd,
  onRemove,
  onRename,
  placeholder,
  hideAdd,
}: {
  items: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
  onRename?: (oldName: string, newName: string) => void;
  placeholder: string;
  hideAdd?: boolean;
}) {
  const colors = useColors();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    onAdd(v);
    setDraft("");
    tap();
  };

  const startEdit = (item: string) => {
    setEditing(item);
    setEditDraft(item);
    tap();
  };

  const commitEdit = () => {
    if (editing != null) {
      const v = editDraft.trim();
      if (v && v !== editing) onRename?.(editing, v);
    }
    setEditing(null);
    setEditDraft("");
  };

  return (
    <View style={{ gap: 10 }}>
      <View style={styles.chipWrap}>
        {items.length === 0 ? (
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>
            None yet — add one below.
          </Text>
        ) : (
          items.map((item) =>
            editing === item ? (
              <View key={item} style={styles.editRow}>
                <TextInput
                  style={[
                    styles.editInput,
                    { color: colors.foreground, borderColor: colors.primary },
                  ]}
                  value={editDraft}
                  onChangeText={setEditDraft}
                  autoFocus
                  autoCapitalize="words"
                  onSubmitEditing={commitEdit}
                  returnKeyType="done"
                />
                <Pressable onPress={commitEdit} hitSlop={6} style={styles.editIconBtn}>
                  <Feather name="check" size={16} color={colors.primary} />
                </Pressable>
                <Pressable
                  onPress={() => {
                    setEditing(null);
                    setEditDraft("");
                  }}
                  hitSlop={6}
                  style={styles.editIconBtn}
                >
                  <Feather name="x" size={16} color={colors.mutedForeground} />
                </Pressable>
              </View>
            ) : (
              <View
                key={item}
                style={[
                  styles.chip,
                  { borderColor: colors.border, backgroundColor: colors.secondary },
                ]}
              >
                {onRename ? (
                  <Pressable onPress={() => startEdit(item)} hitSlop={4}>
                    <Text style={[styles.chipText, { color: colors.foreground }]}>
                      {item}
                    </Text>
                  </Pressable>
                ) : (
                  <Text style={[styles.chipText, { color: colors.foreground }]}>
                    {item}
                  </Text>
                )}
                <Pressable
                  onPress={() => {
                    onRemove(item);
                    tap();
                  }}
                  hitSlop={6}
                >
                  <Feather name="x" size={13} color={colors.mutedForeground} />
                </Pressable>
              </View>
            ),
          )
        )}
      </View>
      {hideAdd ? null : (
        <View style={styles.addRow}>
          <TextInput
            style={[
              styles.input,
              { color: colors.foreground, borderColor: colors.border },
            ]}
            value={draft}
            onChangeText={setDraft}
            placeholder={placeholder}
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="words"
            onSubmitEditing={add}
            returnKeyType="done"
          />
          <Pressable
            onPress={add}
            disabled={!draft.trim()}
            style={({ pressed }) => [
              styles.addBtn,
              {
                backgroundColor: colors.primary,
                opacity: !draft.trim() ? 0.4 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Feather name="plus" size={18} color={colors.primaryForeground} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

// Combine duplicate / similar ingredient names into one canonical target.
// Mirrors the web "Merge" panel in `run-calculator/src/pages/home.tsx`.
function MergeManager({ autoSuggest = 0 }: { autoSuggest?: number }) {
  const colors = useColors();
  const {
    pepTypes,
    cheeseIngredients,
    doughIngredients,
    frontlineIngredients,
    dieTypes,
    allRuns,
    templates,
    history,
    brandProfiles,
    doughRecipePresets,
    cheeseRecipePresets,
    frontlineRecipePresets,
    mixRecipePresets,
    mergeIngredients,
    brands,
    brandFlavors,
    mergeBrands,
    mergeFlavors,
  } = useRun();

  const [sources, setSources] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Which category the manual merge picker is scoped to. The first five scope the
  // source/target lists to one master-data group; "brandflavor" swaps in the
  // brand/flavor merge path. (Mobile has no mix-ingredient list, so the Mixes tab
  // shows a graceful empty state — kept for structural parity with web.)
  type MergeCategory = "ingredients" | "mixes" | "dough" | "sauce" | "cheese" | "brandflavor";
  const [category, setCategory] = useState<MergeCategory>("ingredients");
  const [bfMode, setBfMode] = useState<"brands" | "flavors">("brands");
  const [bfBrand, setBfBrand] = useState("");
  // AI + learned-memory merge suggestions (reviewed before applying).
  const [suggestions, setSuggestions] = useState<ReviewedMergeSuggestion[]>([]);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [suggestError, setSuggestError] = useState("");
  const [suggestNote, setSuggestNote] = useState("");
  const [suggestRan, setSuggestRan] = useState(false);
  // True when this scan was kicked off automatically by a recipe import, so we
  // can explain to the user why suggestions appeared.
  const [fromImport, setFromImport] = useState(false);

  const dedupSorted = (all: string[]) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of all) {
      const k = n.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(n);
      }
    }
    return out.sort((a, b) => a.localeCompare(b));
  };

  // The full mergeable universe: every master-data list whose values a merge
  // rewrites — ingredient names plus die types (the `dieType` selection field is
  // rewritten too). Used by the AI "Suggested merges" scan + import auto-check,
  // which look for duplicates ACROSS categories. Brands/flavors excluded (they
  // have their own merge path). (Mobile has no ingredientTypes/mixIngredients.)
  const fullUniverse = React.useMemo(
    () => dedupSorted([
      ...pepTypes,
      ...cheeseIngredients,
      ...doughIngredients,
      ...frontlineIngredients,
      ...dieTypes,
    ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pepTypes, cheeseIngredients, doughIngredients, frontlineIngredients, dieTypes],
  );

  // The names the manual source/target pickers offer, scoped to the selected
  // category so a merge stays within its own group. On the brand/flavor tab the
  // universe is the brand list (brands mode) or one brand's flavors (flavors
  // mode). Mixes is always empty on mobile (no mix-ingredient list).
  const universe = React.useMemo(() => {
    switch (category) {
      case "mixes":
        return [];
      case "dough":
        return dedupSorted(doughIngredients);
      case "sauce":
        return dedupSorted(frontlineIngredients);
      case "cheese":
        return dedupSorted(cheeseIngredients);
      case "brandflavor":
        return dedupSorted(bfMode === "brands" ? brands : (brandFlavors[bfBrand] ?? []));
      case "ingredients":
      default:
        return dedupSorted([...pepTypes, ...dieTypes]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, bfMode, bfBrand, brands, brandFlavors, pepTypes, dieTypes, doughIngredients, frontlineIngredients, cheeseIngredients]);

  // Which merge-suggest category/brand/pool the AI scan and learned-alias
  // memory should use for the currently active tab. Each tab scans and stores
  // ONLY its own name pool (`universe`, already scoped above), except
  // "ingredients" which keeps scanning the cross-category `fullUniverse`
  // (unchanged prior behavior). Web parity — mobile's per-tab pools are
  // ingredient-scoped rather than recipe-name-scoped (see universe above),
  // which is an intentional, pre-existing platform difference; only the
  // scan/apply/deny wiring is aligned here.
  const suggestScope = React.useMemo((): {
    category: MergeSuggestCategory;
    brand?: string;
    universe: string[];
  } => {
    switch (category) {
      case "mixes":
        return { category: "mixes", universe };
      case "dough":
        return { category: "dough", universe };
      case "sauce":
        return { category: "sauce", universe };
      case "cheese":
        return { category: "cheese", universe };
      case "brandflavor":
        return bfMode === "brands"
          ? { category: "brand", universe }
          : { category: "flavor", brand: bfBrand, universe };
      case "ingredients":
      default:
        return { category: "ingredient", universe: fullUniverse };
    }
  }, [category, bfMode, bfBrand, universe, fullUniverse]);

  // Same universe, ordered closest-match-first so likely duplicates surface at the
  // top. Rank by best similarity to any selected source (or the typed target);
  // fall back to alphabetical. Reuses the shared name-similarity helper.
  const rankedUniverse = React.useMemo(() => {
    const probes = [...sources, target.trim()].filter(Boolean);
    if (probes.length === 0) return universe;
    return universe
      .map((name, i) => ({
        name,
        i,
        s: Math.max(...probes.map((p) => scoreNameMatch(p, name))),
      }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x) => x.name);
  }, [universe, sources, target]);

  const map: MergeMap = buildMergeMap(sources, target);
  const hasMerge = Object.keys(map).length > 0;

  const previewCount = React.useMemo(() => {
    if (!hasMerge) return 0;
    const settingsObjects = [
      ...allRuns.map((r) => r.settings),
      ...templates.map((t) => t.settings),
      ...history.flatMap((d) => d.runs.map((r) => r.settings)),
      ...Object.values(brandProfiles),
    ] as unknown as Record<string, unknown>[];
    try {
      return countMergeReferences(map, {
        lists: [pepTypes, cheeseIngredients, doughIngredients, frontlineIngredients, dieTypes],
        settingsObjects,
        presetMaps: [
          doughRecipePresets,
          cheeseRecipePresets,
          frontlineRecipePresets,
          mixRecipePresets,
        ],
      });
    } catch {
      return 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, target]);

  const toggleSource = (name: string) => {
    setError("");
    setConfirming(false);
    setSources((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  };

  const reset = () => {
    setSources([]);
    setTarget("");
    setConfirming(false);
    setBusy(false);
    setError("");
  };

  // Ask for duplicate-group suggestions (AI clustering + learned aliases).
  // Reviewed, never auto-applied: "Load" pre-fills the form, "Apply" merges
  // directly through the same destructive merge path.
  const suggest = async (importTriggered = false) => {
    if (!importTriggered) setFromImport(false);
    // The import-triggered auto-scan always lands on (and scans) the
    // Ingredients tab — use `fullUniverse` directly rather than
    // `suggestScope`, since `setCategory("ingredients")` in the caller effect
    // hasn't re-rendered yet and the scope memo would still reflect whatever
    // tab was active before.
    const scope = importTriggered
      ? { category: "ingredient" as const, universe: fullUniverse }
      : suggestScope;
    setSuggestBusy(true);
    setSuggestError("");
    setSuggestNote("");
    setSuggestRan(true);
    try {
      const { suggestions: out, usedAi, error: err } = await suggestMerges(
        scope.universe,
        scope.category,
        scope.brand,
      );
      setSuggestions(out);
      if (!usedAi && err) {
        setSuggestError(`AI unavailable (${err}). Showing previously-merged suggestions only.`);
      }
      if (usedAi && out.length === 0) setSuggestNote("No duplicate groups found.");
    } catch (e) {
      setSuggestions([]);
      setSuggestError(e instanceof Error ? e.message : "Couldn't get suggestions.");
    } finally {
      setSuggestBusy(false);
    }
  };

  // After a recipe import the parent bumps `autoSuggest`; run the merge check
  // once (imported recipe ingredients can duplicate standalone ones) and flag
  // the run as import-triggered so the explainer banner shows. Fire-and-forget
  // — suggest() handles its own errors and never throws.
  React.useEffect(() => {
    if (autoSuggest === 0) return;
    // Land on the Ingredients tab, where the cross-category AI suggestions show.
    setCategory("ingredients");
    setFromImport(true);
    void suggest(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSuggest]);

  // Switch the merge category, clearing the picker + any open AI suggestions so
  // nothing leaks across categories. Mirrors web `switchMergeCategory`.
  const switchCategory = (c: MergeCategory) => {
    if (c === category) return;
    setCategory(c);
    reset();
    setSuggestions([]);
    setSuggestRan(false);
    setSuggestError("");
    setSuggestNote("");
    setFromImport(false);
    if (c === "brandflavor" && !bfBrand && brands.length > 0) setBfBrand(brands[0]);
  };

  const loadSuggestion = (s: ReviewedMergeSuggestion) => {
    setError("");
    setConfirming(false);
    setFromImport(false);
    // Suggestions shown are always scoped to the currently active tab (each
    // scan uses that tab's own pool), so snap names against that same pool —
    // never force a tab switch.
    const canon = (n: string) =>
      suggestScope.universe.find((u) => u.toLowerCase() === n.trim().toLowerCase()) ?? n.trim();
    const tgt = canon(s.target);
    const seen = new Set<string>();
    const srcs: string[] = [];
    for (const raw of s.sources) {
      const n = canon(raw);
      const key = n.toLowerCase();
      if (key === tgt.toLowerCase() || seen.has(key)) continue;
      seen.add(key);
      srcs.push(n);
    }
    setTarget(tgt);
    setSources(srcs);
  };

  const applySuggestion = async (s: ReviewedMergeSuggestion) => {
    const srcs = s.sources.filter((n) => n !== s.target);
    if (srcs.length === 0) return;
    setFromImport(false);
    setBusy(true);
    setError("");
    try {
      if (category === "brandflavor") {
        if (bfMode === "brands") mergeBrands(srcs, s.target);
        else mergeFlavors(bfBrand, srcs, s.target);
      } else {
        await mergeIngredients(srcs, s.target, suggestScope.category);
      }
      reset();
      // Drop just this suggestion so the user can keep working through the rest
      // of the list (web parity).
      setSuggestions((prev) => prev.filter((x) => x !== s));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Merge failed. Please try again.");
    }
  };

  // Ignore a suggested group: persist {target, source} pairs as denied so the
  // suggester never proposes them again (factory-wide, scoped to the active
  // tab's category/brand), then drop it locally. Best-effort persistence — the
  // suggestion is hidden either way (web parity).
  const ignoreSuggestion = async (s: ReviewedMergeSuggestion) => {
    const srcs = s.sources.filter((n) => n !== s.target);
    if (srcs.length === 0) return;
    setFromImport(false);
    setSuggestions((prev) => prev.filter((x) => x !== s));
    try {
      await denyMerge(s.target, srcs, suggestScope.category, suggestScope.brand);
    } catch {
      // Non-fatal: hidden for this session; may reappear later if it didn't persist.
    }
  };

  const apply = async () => {
    if (!hasMerge) {
      setError("Pick at least one source and a different target.");
      return;
    }
    if (category === "brandflavor" && bfMode === "flavors" && !bfBrand.trim()) {
      setError("Pick a brand first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (category === "brandflavor") {
        if (bfMode === "brands") mergeBrands(sources, target);
        else mergeFlavors(bfBrand, sources, target);
      } else {
        await mergeIngredients(sources, target, suggestScope.category);
      }
      reset();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Merge failed. Please try again.");
    }
  };

  const emptyMessage =
    category === "brandflavor"
      ? bfMode === "brands"
        ? "No brands to merge yet."
        : bfBrand
          ? `No flavors for ${bfBrand} to merge yet.`
          : "Pick a brand to see its flavors."
      : category === "mixes"
        ? "No mix ingredients to merge here."
        : category === "dough"
          ? "No dough ingredients to merge yet."
          : category === "sauce"
            ? "No sauce ingredients to merge yet."
            : category === "cheese"
              ? "No cheese-mix ingredients to merge yet."
              : "No ingredients to merge yet.";

  const MERGE_TABS: [MergeCategory, string][] = [
    ["ingredients", "Ingredients"],
    ["mixes", "Mixes"],
    ["dough", "Dough"],
    ["sauce", "Sauce"],
    ["cheese", "Cheese mixes"],
    ["brandflavor", "Brand/Flavor"],
  ];

  return (
    <View style={{ gap: 12 }}>
      {fromImport ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: colors.primary,
            backgroundColor: colors.secondary,
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
          }}
        >
          <Text style={[styles.previewText, { color: colors.foreground }]}>
            Recipes were imported. Since recipe ingredients can also be used on their
            own, we checked them for possible duplicates below — review any suggestions
            before they become separate items.
          </Text>
        </View>
      ) : null}

      {/* Category selector: scope the manual merge to one group. */}
      <View style={styles.chipWrap}>
        {MERGE_TABS.map(([key, label]) => {
          const active = category === key;
          return (
            <Pressable
              key={key}
              disabled={busy}
              onPress={() => switchCategory(key)}
              style={({ pressed }) => [
                styles.catTab,
                {
                  borderColor: active ? colors.primary : colors.border,
                  backgroundColor: active ? colors.primary : "transparent",
                  opacity: busy ? 0.5 : pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.catTabText,
                  { color: active ? colors.primaryForeground : colors.mutedForeground },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Brand/Flavor sub-mode: merge whole brands, or flavors within one brand. */}
      {category === "brandflavor" ? (
        <View style={{ gap: 8 }}>
          <View style={styles.addRow}>
            {(["brands", "flavors"] as const).map((m) => {
              const active = bfMode === m;
              return (
                <Pressable
                  key={m}
                  disabled={busy}
                  onPress={() => {
                    if (m === bfMode) return;
                    setBfMode(m);
                    reset();
                    setSuggestions([]);
                    setSuggestRan(false);
                    setSuggestError("");
                    setSuggestNote("");
                    if (m === "flavors" && !bfBrand && brands.length > 0) setBfBrand(brands[0]);
                  }}
                  style={({ pressed }) => [
                    styles.catTab,
                    {
                      flex: 1,
                      alignItems: "center",
                      borderColor: active ? colors.primary : colors.border,
                      backgroundColor: active ? colors.primary : "transparent",
                      opacity: busy ? 0.5 : pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.catTabText,
                      { color: active ? colors.primaryForeground : colors.mutedForeground },
                    ]}
                  >
                    {m === "brands" ? "Brands" : "Flavors"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {bfMode === "flavors" ? (
            <View style={{ gap: 6 }}>
              <Text style={[styles.mergeLabel, { color: colors.mutedForeground }]}>BRAND</Text>
              {brands.length === 0 ? (
                <Text style={[styles.previewSub, { color: colors.mutedForeground }]}>
                  No brands yet.
                </Text>
              ) : (
                <View style={styles.chipWrap}>
                  {brands.map((b) => {
                    const active = b === bfBrand;
                    return (
                      <Pressable
                        key={b}
                        disabled={busy}
                        onPress={() => {
                          setBfBrand(b);
                          reset();
                          setSuggestions([]);
                          setSuggestRan(false);
                          setSuggestError("");
                          setSuggestNote("");
                        }}
                        style={[
                          styles.targetChip,
                          {
                            borderColor: active ? colors.primary : colors.border,
                            backgroundColor: active ? colors.primary : "transparent",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.targetChipText,
                            { color: active ? colors.primaryForeground : colors.mutedForeground },
                          ]}
                        >
                          {b}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          ) : null}
        </View>
      ) : null}

      <Text style={[styles.pinHint, { color: colors.mutedForeground, marginBottom: 0 }]}>
        {category === "brandflavor"
          ? bfMode === "brands"
            ? "Combine duplicate brands into one. Pick the brand(s) to merge away, then the one to keep — their flavors are folded together and today's runs are re-pointed. This can't be undone."
            : "Combine duplicate flavors within a brand. Pick the flavor(s) to merge away, then the one to keep — today's runs are re-pointed. This can't be undone."
          : "Combine duplicate or similar ingredients into one. Pick the ingredient(s) to merge away, then the one to keep. Every recipe, list, preset, profile, run, template and history entry is updated, and inventory stock is folded into the target. This can't be undone."}
      </Text>

      {/* AI + learned-memory suggestions: scan the ACTIVE tab's own name pool
          for duplicate groups (Ingredients keeps scanning the cross-category
          fullUniverse, unchanged). Hidden on Flavors mode until a brand is
          picked (no scoped pool yet) and whenever the active pool is empty.
          Web parity. */}
      {suggestScope.universe.length > 0 &&
      !(category === "brandflavor" && bfMode === "flavors" && !bfBrand.trim()) ? (
      <View
        style={[
          styles.suggestBox,
          { borderColor: colors.border, backgroundColor: colors.secondary },
        ]}
      >
        <View style={styles.suggestHeader}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={[styles.suggestTitle, { color: colors.foreground }]}>
              Suggested merges
            </Text>
            <Text style={[styles.previewSub, { color: colors.mutedForeground }]}>
              Scan for likely duplicates and previously-merged names.
            </Text>
          </View>
          <Pressable
            onPress={() => suggest()}
            disabled={suggestBusy || busy}
            style={({ pressed }) => [
              styles.suggestBtn,
              {
                borderColor: colors.primary,
                opacity: suggestBusy || busy ? 0.5 : pressed ? 0.7 : 1,
              },
            ]}
          >
            {suggestBusy ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={[styles.suggestBtnText, { color: colors.primary }]}>
                Suggest with AI
              </Text>
            )}
          </Pressable>
        </View>

        {suggestError ? (
          <Text style={[styles.previewSub, { color: colors.destructive }]}>
            {suggestError}
          </Text>
        ) : null}
        {suggestRan && !suggestBusy && suggestions.length === 0 && !suggestError ? (
          <Text style={[styles.previewSub, { color: colors.mutedForeground }]}>
            {suggestNote || "No duplicate groups found."}
          </Text>
        ) : null}

        {suggestions.map((s, i) => {
          const srcs = s.sources.filter((n) => n !== s.target);
          if (srcs.length === 0) return null;
          return (
            <View
              key={`${s.target}-${i}`}
              style={[
                styles.suggestItem,
                { borderColor: colors.border, backgroundColor: colors.background },
              ]}
            >
              <Text style={[styles.previewText, { color: colors.foreground }]}>
                <Text style={{ color: colors.mutedForeground }}>{srcs.join(", ")}</Text>
                {" → "}
                <Text style={{ color: colors.primary, fontFamily: FONTS.bold }}>
                  {s.target}
                </Text>
              </Text>
              {s.reason ? (
                <Text style={[styles.previewSub, { color: colors.mutedForeground }]}>
                  {s.reason}
                </Text>
              ) : null}
              {s.review ? (
                <View style={{ marginTop: 4 }}>
                  <ReviewBadge review={s.review} />
                </View>
              ) : null}
              <View style={[styles.addRow, { marginTop: 2 }]}>
                <Pressable
                  onPress={() => loadSuggestion(s)}
                  disabled={busy || suggestBusy}
                  style={({ pressed }) => [
                    styles.suggestActionBtn,
                    { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <Text style={[styles.suggestActionText, { color: colors.foreground }]}>
                    Load
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => applySuggestion(s)}
                  disabled={busy || suggestBusy}
                  style={({ pressed }) => [
                    styles.suggestActionBtn,
                    {
                      borderColor: colors.primary,
                      backgroundColor: colors.primary,
                      opacity: busy || suggestBusy ? 0.5 : pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[styles.suggestActionText, { color: colors.primaryForeground }]}
                  >
                    Apply
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => ignoreSuggestion(s)}
                  disabled={busy || suggestBusy}
                  style={({ pressed }) => [
                    styles.suggestActionBtn,
                    { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <Text style={[styles.suggestActionText, { color: colors.mutedForeground }]}>
                    Ignore
                  </Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>
      ) : null}

      {universe.length === 0 ? (
        <Text style={[styles.empty, { color: colors.mutedForeground }]}>{emptyMessage}</Text>
      ) : (
        <>
      <Text style={[styles.mergeLabel, { color: colors.mutedForeground }]}>
        MERGE THESE (SOURCES)
      </Text>
      <View style={styles.chipWrap}>
        {rankedUniverse.map((name) => {
          const checked = sources.includes(name);
          const isTarget = name === target.trim();
          return (
            <Pressable
              key={name}
              disabled={isTarget || busy}
              onPress={() => toggleSource(name)}
              style={[
                styles.chip,
                {
                  borderColor: checked ? colors.primary : colors.border,
                  backgroundColor: checked ? colors.primary : colors.secondary,
                  opacity: isTarget ? 0.4 : 1,
                },
              ]}
            >
              {checked ? (
                <Feather name="check" size={12} color={colors.primaryForeground} />
              ) : null}
              <Text
                style={[
                  styles.chipText,
                  { color: checked ? colors.primaryForeground : colors.foreground },
                ]}
              >
                {name}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.mergeLabel, { color: colors.mutedForeground }]}>
        KEEP THIS ONE (TARGET)
      </Text>
      <TextInput
        style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
        value={target}
        onChangeText={(t) => {
          setTarget(t);
          setConfirming(false);
          setError("");
        }}
        placeholder="Type or pick the ingredient to keep…"
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize="words"
      />
      <View style={styles.chipWrap}>
        {rankedUniverse.map((name) => (
          <Pressable
            key={name}
            disabled={busy}
            onPress={() => {
              setTarget(name);
              setConfirming(false);
              setError("");
            }}
            style={[
              styles.targetChip,
              {
                borderColor: name === target.trim() ? colors.primary : colors.border,
                backgroundColor:
                  name === target.trim() ? colors.primary : "transparent",
              },
            ]}
          >
            <Text
              style={[
                styles.targetChipText,
                {
                  color:
                    name === target.trim()
                      ? colors.primaryForeground
                      : colors.mutedForeground,
                },
              ]}
            >
              {name}
            </Text>
          </Pressable>
        ))}
      </View>

      {error ? (
        <Text style={[styles.mergeError, { color: colors.destructive }]}>{error}</Text>
      ) : null}

      {hasMerge ? (
        <View
          style={[
            styles.previewBox,
            { borderColor: colors.primary, backgroundColor: colors.secondary },
          ]}
        >
          <Text style={[styles.previewText, { color: colors.foreground }]}>
            Merging{" "}
            <Text style={{ color: colors.primary, fontFamily: FONTS.bold }}>
              {Object.keys(map).join(", ")}
            </Text>{" "}
            →{" "}
            <Text style={{ color: colors.primary, fontFamily: FONTS.bold }}>
              {target.trim()}
            </Text>
          </Text>
          <Text style={[styles.previewSub, { color: colors.mutedForeground }]}>
            {category === "brandflavor"
              ? bfMode === "brands"
                ? "Their flavors are folded together and today's runs are re-pointed to the kept brand."
                : "Today's runs are re-pointed to the kept flavor."
              : `${previewCount} reference${previewCount === 1 ? "" : "s"} will be updated. Inventory stock for merged items folds into the target.`}
          </Text>
        </View>
      ) : null}

      <View style={styles.addRow}>
        <Pressable
          onPress={reset}
          disabled={busy}
          style={({ pressed }) => [
            styles.clearPinBtn,
            { borderColor: colors.border, marginTop: 0, flex: 1, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Text style={[styles.clearPinText, { color: colors.foreground }]}>Clear</Text>
        </Pressable>
        {!confirming ? (
          <Pressable
            onPress={() => {
              setError("");
              setConfirming(true);
              tap();
            }}
            disabled={!hasMerge || busy}
            style={({ pressed }) => [
              styles.mergeBtn,
              {
                backgroundColor: colors.primary,
                opacity: !hasMerge || busy ? 0.4 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[styles.mergeBtnText, { color: colors.primaryForeground }]}>
              Merge…
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={apply}
            disabled={busy}
            style={({ pressed }) => [
              styles.mergeBtn,
              {
                backgroundColor: colors.destructive,
                opacity: busy ? 0.6 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[styles.mergeBtnText, { color: colors.primaryForeground }]}>
              {busy ? "Merging…" : "Confirm merge"}
            </Text>
          </Pressable>
        )}
      </View>
        </>
      )}
    </View>
  );
}

type MobileSheetCoverage = {
  sheetId: number;
  sheetLabel: string;
  discrepancies: Discrepancy[];
};
type MobileRecipeEntry = {
  kind: ReconcileKind;
  name: string;
  inLibrary: boolean;
  coverage: MobileSheetCoverage[];
};
function buildMobileCombinedView(
  sheets: SavedSpecSheet[],
  currentRecipes: ReconcileRecipe[],
): MobileRecipeEntry[] {
  const recipeMap = new Map<string, MobileRecipeEntry>();
  for (const r of currentRecipes) {
    const key = `${r.kind}\0${r.name.trim().toLowerCase()}`;
    if (!recipeMap.has(key)) recipeMap.set(key, { kind: r.kind, name: r.name, inLibrary: true, coverage: [] });
  }
  for (const sheet of sheets) {
    const specRecipes = toReconcileRecipes(sheet.data?.recipes);
    const discrepancies = reconcileSpecWithRecipes({ specRecipes, currentRecipes });
    const discsByKey = new Map<string, Discrepancy[]>();
    for (const d of discrepancies) {
      if (d.type === "missing-recipe") continue;
      const key = `${d.kind}\0${d.recipeName.trim().toLowerCase()}`;
      const arr = discsByKey.get(key) ?? [];
      arr.push(d);
      discsByKey.set(key, arr);
    }
    for (const sr of specRecipes) {
      const key = `${sr.kind}\0${sr.name.trim().toLowerCase()}`;
      const existing = recipeMap.get(key);
      const discs = discsByKey.get(key) ?? [];
      if (existing) {
        existing.coverage.push({ sheetId: sheet.id, sheetLabel: sheet.label, discrepancies: discs });
      } else {
        recipeMap.set(key, { kind: sr.kind, name: sr.name, inLibrary: false, coverage: [{ sheetId: sheet.id, sheetLabel: sheet.label, discrepancies: [] }] });
      }
    }
  }
  return Array.from(recipeMap.values());
}
// Flavor corrections captured at import time ride along on the saved parse
// (ParsedSpecImport.warnings) so they stay visible when a manager re-opens the
// sheet later. Same amber styling as the import review modal; parity with the
// web SpecReconcilePanel callout. Exported (and testID'd to mirror the web
// data-testids) so the web-side regression test can render it through the
// strip-imports mobile harness — see
// artifacts/run-calculator/src/mobileSpecSheetWarningsCallout.test.tsx.
export function SpecSheetWarningsCallout({
  sheet,
  expanded,
  onToggle,
  colors,
}: {
  sheet: SavedSpecSheet;
  expanded: boolean;
  onToggle: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const warnings = sheet.data?.warnings;
  if (!Array.isArray(warnings) || warnings.length === 0) return null;
  return (
    <View
      testID={`spec-sheet-warnings-${sheet.id}`}
      style={{
        borderWidth: 1,
        borderRadius: 8,
        padding: 8,
        gap: 6,
        backgroundColor: "rgba(245,158,11,0.12)",
        borderColor: "rgba(245,158,11,0.4)",
      }}
    >
      <Pressable
        testID={`button-spec-sheet-warnings-${sheet.id}`}
        onPress={onToggle}
        style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
      >
        <Feather name="alert-triangle" size={13} color={colors.warning} />
        <Text
          style={{
            flex: 1,
            fontSize: 12,
            fontFamily: FONTS.medium,
            color: colors.warning,
          }}
        >
          {warnings.length} flavor name
          {warnings.length === 1 ? " was" : "s were"} corrected or
          flagged at import
        </Text>
        <Feather
          name={expanded ? "chevron-down" : "chevron-right"}
          size={14}
          color={colors.warning}
        />
      </Pressable>
      {expanded
        ? warnings.map((w, i) => (
            <View key={i} style={{ gap: 1 }}>
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: FONTS.medium,
                  color: colors.foreground,
                }}
              >
                {w.brand} — {w.flavor}
              </Text>
              <Text style={{ fontSize: 12, color: colors.warning }}>
                {w.message}
              </Text>
            </View>
          ))
        : null}
    </View>
  );
}

const MOBILE_KIND_ORDER: ReconcileKind[] = ["dough", "sauce", "cheese"];
const MOBILE_KIND_LABELS: Record<ReconcileKind, string> = { dough: "Dough", sauce: "Sauce", cheese: "Cheese" };

export default function MasterDataScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    brands,
    brandFlavors,
    dieTypes,
    pepTypes,
    cheeseIngredients,
    doughIngredients,
    frontlineIngredients,
    stopReasons,
    addListItem,
    removeListItem,
    renameListItem,
    renameBrand,
    addFlavor,
    removeFlavor,
    renameFlavor,
    mixRecipePresets,
    deleteRecipePreset,
    renameRecipePreset,
    supervisorPin,
    setSupervisorPin,
    brandProfiles,
    doughRecipePresets,
    cheeseRecipePresets,
    frontlineRecipePresets,
    applySpecImport,
    changeHistory,
    undoMasterDataChange,
    addScheduledRun,
    importScheduledRuns,
    allRuns,
    updateRunSettingsById,
  } = useRun();
  const { isManager, hasCapability } = useMe();
  const mixesQc = useQueryClient();
  const canEditRules = hasCapability("edit-production-rules");
  const canManageInventory = hasCapability("manage-inventory");
  const canManageStaff = hasCapability("manage-staff");
  const canApproveResets = hasCapability("approve-password-resets");

  const [pinDraft, setPinDraft] = useState("");
  const [pinMsg, setPinMsg] = useState("");
  const [importResult, setImportResult] = useState<ImportParseResult | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  async function handleExcelImportPick() {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: [
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.ms-excel",
          "*/*",
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      let parsed: ImportParseResult;
      if (Platform.OS === "web") {
        const resp = await fetch(asset.uri);
        const ab = await resp.arrayBuffer();
        parsed = parseWorkbookObject(XLSX.read(ab, { type: "array" }));
      } else {
        const b64 = await Promise.resolve(new File(asset.uri).base64());
        parsed = parseRunWorkbookBase64(b64);
      }
      // Multi-sheet schedule planner: keep only runs dated today-or-later and
      // route to the multi-date override commit (mirrors the Schedule screen).
      const result = parsed.multiDay ? filterImportFromDate(parsed, todayStr()) : parsed;
      setImportResult(result);
      setImportOpen(true);
    } catch {
      showNote(
        "Couldn't read that file",
        "The spreadsheet couldn't be read. Check the format and try again.",
      );
    }
  }

  function commitExcelImport(payload: ImportCommit) {
    try {
      payload.createBrands.forEach((b) => addListItem("brands", b));
      payload.createFlavors.forEach((cf) => addFlavor(cf.brand, cf.flavor));
      let count = 0;
      let skipped = 0;
      const caseUpdateOffers: CaseUpdateOffer[] = [];
      if (payload.multiDay) {
        const byDate = (payload.byDate ?? []).map((day) => ({
          date: day.date,
          runs: day.runs.map((r) => ({
            brand: r.brand,
            flavor: r.flavor,
            casesNeeded: r.casesPlanned,
            dieType: brandProfiles[profileKey(r.brand, r.flavor)]?.dieType ?? "",
            notes: r.notes,
          })),
        }));
        // TODAY only: drop file rows matching live runs already started/ended so
        // a re-import that includes today can't duplicate work the floor already
        // did (mirrors web commitMultiDayImport).
        const alreadyRan = allRuns
          .filter((r) => r.startedAt || r.endedAt)
          .map((r) => ({
            brand: r.settings.brand,
            flavor: r.settings.flavor,
            id: r.id,
            startedAt: r.startedAt,
            endedAt: r.endedAt,
            casesNeeded: r.settings.casesNeeded,
            casesMade:
              r.progress.skidsCompleted * r.settings.casesPerSkid +
              r.progress.casesOnCurrentSkid,
          }));
        const today = todayStr();
        const effective = byDate.map((day) => {
          if (day.date !== today) return day;
          const res = skipAlreadyRanRuns(day.runs, alreadyRan);
          skipped += res.skipped;
          // A skipped row may list a NEW case count for a run already going —
          // collect an offer (never auto-applied; finished runs untouched).
          caseUpdateOffers.push(...buildCaseUpdateOffers(res.matches));
          return { ...day, runs: res.rows };
        });
        count = effective.reduce((n, d) => n + d.runs.length, 0);
        importScheduledRuns(effective);
      } else {
        payload.runs.forEach((r) => {
          const dieType = brandProfiles[profileKey(r.brand, r.flavor)]?.dieType ?? "";
          addScheduledRun(payload.date, {
            brand: r.brand,
            flavor: r.flavor,
            casesNeeded: r.casesPlanned,
            dieType,
            notes: r.notes,
          });
        });
        count = payload.runs.length;
      }
      setImportOpen(false);
      setImportResult(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const summary = `${count} run${count === 1 ? "" : "s"} imported.${skipped > 0 ? ` ${skipped} already ran today, skipped.` : ""}`;
      if (caseUpdateOffers.length > 0) {
        // Fold the import summary into the offer alert (RN can't reliably
        // stack two alerts back-to-back on Android).
        promptCaseUpdates(caseUpdateOffers, `${summary}\n\n`, (o) =>
          updateRunSettingsById(o.runId, { casesNeeded: o.to }),
        );
      } else {
        showNote("Import complete", summary);
      }
    } catch (e) {
      showNote(
        "Import failed",
        e instanceof Error ? e.message : "Could not import the runs. Please try again.",
      );
    }
  }

  // Dev-only browser test hook (shared with Schedule + Summary — see
  // utils/devTestImport.ts): commits a staged ImportCommit from localStorage
  // "rc_test_import" (screen:"master-data") through the SAME commit path.
  useDevTestImport({
    screen: "master-data",
    allRuns,
    today: todayStr(),
    commit: commitExcelImport,
  });

  const mixNames = Object.keys(mixRecipePresets);

  // Confirm + roll back to just before this entry (it plus every newer change).
  // Warns when a merge is in the rolled-back range: undo reverses names/lists but
  // does NOT un-fold inventory stock that a merge combined (web parity).
  const confirmUndoChange = (entry: MasterDataChange) => {
    const idx = changeHistory.findIndex((e) => e.id === entry.id);
    const discarded = idx === -1 ? [] : changeHistory.slice(0, idx + 1);
    const hasMerge = discarded.some((e) => e.type === "merge");
    const extra = discarded.length - 1;
    const tail =
      extra > 0 ? ` and ${extra} later change${extra === 1 ? "" : "s"}` : "";
    const warn = hasMerge
      ? "\n\nNote: this reverses the ingredient names and lists, but does NOT un-fold any inventory stock that was combined by a merge. Re-check stock in Inventory."
      : "";
    showConfirm({
      title: "Undo change",
      message: `Undo "${entry.description}"${tail}?${warn}`,
      confirmText: "Undo",
      destructive: true,
      onConfirm: () => {
        undoMasterDataChange(entry.id);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      },
    });
  };

  // ── Excel spec-sheet import (manager only; mirrors the web header action) ──
  const [specOpen, setSpecOpen] = useState(false);
  const [specLoading, setSpecLoading] = useState(false);
  const [specApplying, setSpecApplying] = useState(false);
  const [specError, setSpecError] = useState<string | null>(null);
  const [specPrepared, setSpecPrepared] = useState<SpecImportPrepared | null>(null);
  const [specProgress, setSpecProgress] = useState<{ done: number; total: number } | null>(null);

  // ── Excel premix-sheet import (manager only; mirrors web Mixes section) ──
  const [premixOpen, setPremixOpen] = useState(false);
  const [premixLoading, setPremixLoading] = useState(false);
  const [premixApplying, setPremixApplying] = useState(false);
  const [premixError, setPremixError] = useState<string | null>(null);
  const [premixPrepared, setPremixPrepared] = useState<PremixImportPrepared | null>(null);
  const [premixProgress, setPremixProgress] = useState<{ done: number; total: number } | null>(null);
  // Bumped after a recipe import to make MergeManager auto-run a merge check
  // (imported recipe ingredients can duplicate standalone individual ones).
  const [mergeCheckSignal, setMergeCheckSignal] = useState(0);

  // ── Saved spec sheets: cross-reference against current recipes ──
  const [savedSheets, setSavedSheets] = useState<SavedSpecSheet[]>([]);
  const [sheetsLoading, setSheetsLoading] = useState(true);
  const [sheetBusyId, setSheetBusyId] = useState<number | null>(null);
  // Sheets whose import-time flavor-correction warnings are expanded (parity
  // with the web SpecReconcilePanel amber callout toggle).
  const [warnExpandedIds, setWarnExpandedIds] = useState<Set<number>>(new Set());
  const [reconResult, setReconResult] = useState<SpecReconcileResult | null>(null);
  const [reconError, setReconError] = useState<string | null>(null);
  const [reconAllEntries, setReconAllEntries] = useState<MobileRecipeEntry[] | null>(null);
  const [reconAllBusy, setReconAllBusy] = useState(false);
  // Bumped after a spec sheet import to auto-run the cross-reference.
  const [reconSignal, setReconSignal] = useState(0);
  const prevReconSignalRef = useRef(0);

  const refreshSavedSheets = useCallback(async () => {
    setSheetsLoading(true);
    try {
      setSavedSheets(await fetchSavedSpecSheets());
    } catch {
      // best-effort; leave list as-is
    } finally {
      setSheetsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSavedSheets();
  }, [refreshSavedSheets]);

  // Auto-run cross-reference when signal bumps (e.g. after spec sheet import).
  // Re-fetches the sheet list first so the newly saved sheet is included.
  useEffect(() => {
    if (reconSignal === 0) return;
    if (reconSignal === prevReconSignalRef.current) return;
    prevReconSignalRef.current = reconSignal;
    void (async () => {
      setSheetsLoading(true);
      try {
        const latest = await fetchSavedSpecSheets();
        setSavedSheets(latest);
        if (latest.length > 0) {
          setReconAllBusy(true);
          setReconAllEntries(null);
          setReconResult(null);
          setReconError(null);
          try {
            const currentRecipes = presetMapsToReconcileRecipes({
              dough: doughRecipePresets,
              sauce: frontlineRecipePresets,
              cheese: cheeseRecipePresets,
            });
            setReconAllEntries(buildMobileCombinedView(latest, currentRecipes));
          } catch {
            setReconError("Couldn't build cross-reference. Please try again.");
          } finally {
            setReconAllBusy(false);
          }
        }
      } catch {
        // best-effort; leave list as-is
      } finally {
        setSheetsLoading(false);
      }
    })();
  }, [reconSignal, doughRecipePresets, frontlineRecipePresets, cheeseRecipePresets]);

  async function handleCheckSheet(id: number) {
    setSheetBusyId(id);
    setReconResult(null);
    setReconError(null);
    try {
      const currentRecipes = presetMapsToReconcileRecipes({
        dough: doughRecipePresets,
        sauce: frontlineRecipePresets,
        cheese: cheeseRecipePresets,
      });
      setReconResult(await reconcileSpecSheet(id, currentRecipes));
    } catch {
      setReconError("Couldn't cross-reference that spec sheet. Please try again.");
    } finally {
      setSheetBusyId(null);
    }
  }

  function handleCheckAll() {
    setReconAllBusy(true);
    setReconAllEntries(null);
    setReconResult(null);
    setReconError(null);
    try {
      const currentRecipes = presetMapsToReconcileRecipes({
        dough: doughRecipePresets,
        sauce: frontlineRecipePresets,
        cheese: cheeseRecipePresets,
      });
      setReconAllEntries(buildMobileCombinedView(savedSheets, currentRecipes));
    } catch {
      setReconError("Couldn't build cross-reference. Please try again.");
    } finally {
      setReconAllBusy(false);
    }
  }

  function handleDeleteSheet(id: number) {
    showConfirm({
      title: "Delete saved spec sheet?",
      message: "This removes the saved snapshot.",
      confirmText: "Delete",
      destructive: true,
      onConfirm: async () => {
        setSheetBusyId(id);
        try {
          const next = await deleteSpecSheet(id);
          setSavedSheets(next);
          if (reconResult?.specSheetId === id) setReconResult(null);
        } catch {
          setReconError("Couldn't delete that spec sheet.");
        } finally {
          setSheetBusyId(null);
        }
      },
    });
  }

  // Build the store the orchestration glue needs from live context (web reads
  // localStorage directly; mobile injects the same shape here).
  const buildSpecStore = (): SpecImportStore => {
    const appTypeSet = new Set<string>();
    for (const prof of Object.values(brandProfiles)) {
      for (const slot of [1, 2, 3, 4] as const) {
        const t = prof[`app${slot}Type` as keyof typeof prof];
        if (typeof t === "string" && t.trim()) appTypeSet.add(t);
      }
    }
    const SPEC_FIELDS: (keyof RunSettings)[] = [
      "dieType",
      "sauceOzPerPizza",
      "app1Type",
      "app2Type",
      "app3Type",
      "app4Type",
      "pep1Type",
      "pep2Type",
      "doughRecipeName",
      "frontlineRecipeName",
      "app1CheeseRecipeName",
    ];
    const recipeMapForKind = (
      kind: ParsedRecipe["kind"],
    ): Record<string, unknown> =>
      kind === "dough"
        ? doughRecipePresets
        : kind === "sauce"
          ? frontlineRecipePresets
          : cheeseRecipePresets;
    return {
      known: {
        brands,
        flavorsByBrand: brandFlavors,
        appTypes: [...appTypeSet],
        pepTypes,
        cheeseIngredients,
        doughIngredients,
        sauceIngredients: frontlineIngredients,
        // Existing sauce/frontline recipe names. Mobile has no separate
        // names list (web's FRONTLINE_RECIPE_NAMES_KEY): ready-made sauces
        // are preset keys with empty rows, so the keys ARE the full set.
        sauceNames: Object.keys(frontlineRecipePresets),
        dieTypes,
        // Existing recipe names per kind: lets the server ground a paraphrased
        // recipe name back to the factory's existing recipe (update, not
        // duplicate). Mirrors web's loadSpecImportKnown.
        doughRecipes: Object.keys(doughRecipePresets),
        sauceRecipes: Object.keys(frontlineRecipePresets),
        cheeseRecipes: Object.keys(cheeseRecipePresets),
      },
      currentRecipes: presetMapsToReconcileRecipes({
        dough: doughRecipePresets,
        sauce: frontlineRecipePresets,
        cheese: cheeseRecipePresets,
      }),
      profileExists: (brand, flavor) => {
        const prof = brandProfiles[profileKey(brand, flavor)];
        if (!prof) return false;
        // Mirror web's profileObjHasRealData: any recipe array OR any
        // applicator/pepperoni/die/recipe-name string counts as "real data".
        const arr = (x: unknown) => Array.isArray(x) && x.length > 0;
        const p = prof as Record<string, unknown>;
        if (arr(p.doughRecipe) || arr(p.frontlineRecipe)) return true;
        for (const k of [
          "app1CheeseRecipe",
          "app2CheeseRecipe",
          "app3CheeseRecipe",
          "app4CheeseRecipe",
        ]) {
          if (arr(p[k])) return true;
        }
        return SPEC_FIELDS.some((f) => {
          const v = prof[f];
          return typeof v === "string"
            ? v.trim() !== ""
            : typeof v === "number"
              ? v !== 0
              : false;
        });
      },
      recipeExists: (kind, name) => {
        const map = recipeMapForKind(kind);
        const lower = name.trim().toLowerCase();
        return Object.keys(map).some((k) => k.trim().toLowerCase() === lower);
      },
      apply: applySpecImport,
    };
  };

  async function handleSpecImportPick() {
    setSpecError(null);
    setSpecPrepared(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: [
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.ms-excel",
          "*/*",
        ],
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (picked.canceled || !picked.assets?.length) return;
      const assets = picked.assets.slice(0, MAX_SPEC_IMPORT_FILES);
      setSpecOpen(true);
      setSpecProgress(assets.length > 1 ? { done: 0, total: assets.length } : null);
      setSpecLoading(true);
      const readGrids = async (uri: string) =>
        Platform.OS === "web"
          ? readWorkbookGridsFromArrayBuffer(await (await fetch(uri)).arrayBuffer())
          : readWorkbookGridsFromBase64(await Promise.resolve(new File(uri).base64()));
      const store = buildSpecStore();
      let prepared: SpecImportPrepared;
      if (assets.length === 1) {
        prepared = await prepareSpecImport(await readGrids(assets[0].uri), store);
      } else {
        // Read each workbook independently so one unreadable file doesn't sink
        // the batch — prepareSpecImportMulti skips empties and throws only if
        // every file failed.
        const settled = await Promise.all(
          assets.map((a) => readGrids(a.uri).catch(() => [])),
        );
        prepared = await prepareSpecImportMulti(
          settled,
          store,
          (done, total) => setSpecProgress({ done, total }),
          assets.map((a) => a.name),
        );
      }
      setSpecPrepared(prepared);
    } catch (e) {
      setSpecError(
        e instanceof Error ? e.message : "Could not read or interpret that file.",
      );
    } finally {
      setSpecLoading(false);
      setSpecProgress(null);
    }
  }

  async function handleSpecImportConfirm() {
    if (!specPrepared) return;
    setSpecApplying(true);
    // Capture before clearing: only run the merge check when recipes were
    // actually imported (that's where standalone-duplicate ingredients arise).
    const importedRecipes = (specPrepared.summary?.totalRecipes ?? 0) > 0;
    try {
      await commitSpecImport(specPrepared, buildSpecStore());
      setSpecOpen(false);
      setSpecPrepared(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Fire-and-forget: tells MergeManager to scan the updated lists once.
      if (importedRecipes) setMergeCheckSignal((c) => c + 1);
      // Auto-run spec cross-reference with the newly saved sheet.
      setReconSignal((c) => c + 1);
      showNote(
        "Spec sheet imported",
        importedRecipes
          ? "Brands, flavors, and recipes have been added."
          : "Brands and flavors have been added.",
      );
    } catch (e) {
      setSpecError(
        e instanceof Error ? e.message : "Could not apply the import. Please retry.",
      );
    } finally {
      setSpecApplying(false);
    }
  }

  // Premix import store: the known grounding pool built from live context (web
  // reads localStorage; mobile injects the same shape). Ingredients are the
  // combined cheese+dough+sauce pool, mirroring web's toPremixKnown.
  const buildPremixStore = (): PremixImportStore => ({
    known: {
      brands,
      flavorsByBrand: brandFlavors,
      ingredients: [
        ...new Set([
          ...cheeseIngredients,
          ...doughIngredients,
          ...frontlineIngredients,
        ]),
      ],
    },
  });

  async function handlePremixImportPick() {
    setPremixError(null);
    setPremixPrepared(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: [
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.ms-excel",
          "*/*",
        ],
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (picked.canceled || !picked.assets?.length) return;
      const assets = picked.assets.slice(0, MAX_PREMIX_IMPORT_FILES);
      setPremixOpen(true);
      setPremixProgress(assets.length > 1 ? { done: 0, total: assets.length } : null);
      setPremixLoading(true);
      const readGrids = async (uri: string) =>
        Platform.OS === "web"
          ? readWorkbookGridsFromArrayBuffer(await (await fetch(uri)).arrayBuffer())
          : readWorkbookGridsFromBase64(await Promise.resolve(new File(uri).base64()));
      // Read each workbook independently so one unreadable file doesn't sink the
      // batch — preparePremixImport skips empties and throws only if every file
      // failed.
      const settled = await Promise.all(
        assets.map((a) => readGrids(a.uri).catch(() => [])),
      );
      const prepared = await preparePremixImport(
        settled,
        buildPremixStore(),
        (done, total) => setPremixProgress({ done, total }),
        assets.map((a) => a.name ?? ""),
      );
      setPremixPrepared(prepared);
    } catch (e) {
      setPremixError(
        e instanceof Error ? e.message : "Could not read or interpret that file.",
      );
    } finally {
      setPremixLoading(false);
      setPremixProgress(null);
    }
  }

  async function handlePremixImportConfirm(
    mixesToApply: Mix[],
    freezerPulls: PremixFreezerPull[],
  ) {
    if (!premixPrepared) return;
    setPremixApplying(true);
    try {
      const result = await commitPremixImport(premixPrepared, mixesToApply, freezerPulls);
      // Refresh the shared mixes query so imported mixes appear immediately in
      // the Mixes view and feed the make-day plan without waiting for polling.
      void mixesQc.invalidateQueries({ queryKey: ["mixes"] });
      setPremixOpen(false);
      setPremixPrepared(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const parts = [
        `${mixesToApply.length} mix${mixesToApply.length === 1 ? "" : "es"} saved.`,
      ];
      if (result.freezerPullCount > 0) {
        parts.push(
          `Freezer-pull reminder${result.freezerPullCount === 1 ? "" : "s"} set for ${result.freezerPullCount} ingredient${result.freezerPullCount === 1 ? "" : "s"}.`,
        );
      }
      if (result.warning) parts.push(result.warning);
      showNote("Premix sheet imported", parts.join(" "));
    } catch (e) {
      setPremixError(
        e instanceof Error ? e.message : "Could not apply the import. Please retry.",
      );
    } finally {
      setPremixApplying(false);
    }
  }

  const simpleList = (key: MasterListKey) => ({
    onAdd: (v: string) => addListItem(key, v),
    onRemove: (v: string) => removeListItem(key, v),
    onRename: (oldName: string, newName: string) =>
      renameListItem(key, oldName, newName),
  });

  const webTop = Platform.OS === "web" ? 16 : 0;
  const webBottom = Platform.OS === "web" ? 34 : 0;

  return (
    <>
      <Stack.Screen options={{ title: "Master Data", headerShown: true }} />
      <KeyboardAwareScrollViewCompat
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{
          padding: 16,
          paddingTop: webTop + 8,
          paddingBottom: insets.bottom + webBottom + 48,
          gap: 4,
        }}
      >
        {/* Imports: production schedule (Excel, all staff) + spec sheets/recipes (managers) */}
        <SectionHeader title="Import" />
        <CardSection>
          <Text style={[styles.pinHint, { color: colors.mutedForeground }]}>
            Import a production schedule from an Excel (.xlsx) workbook. You&apos;ll
            see a summary before anything is added.
          </Text>
          <Pressable
            onPress={handleExcelImportPick}
            style={({ pressed }) => [
              styles.importBtn,
              { backgroundColor: colors.primary, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Feather name="upload" size={16} color={colors.primaryForeground} />
            <Text style={[styles.importBtnText, { color: colors.primaryForeground }]}>
              Import Excel…
            </Text>
          </Pressable>
          {isManager ? (
            <>
              <Text
                style={[
                  styles.pinHint,
                  { color: colors.mutedForeground, marginTop: 12 },
                ]}
              >
                Import spec sheets and/or recipes. Existing brand/flavor profiles and
                recipes are overwritten, new ones are added.
              </Text>
              <Pressable
                onPress={handleSpecImportPick}
                style={({ pressed }) => [
                  styles.importBtn,
                  {
                    backgroundColor: colors.secondary,
                    borderWidth: 1,
                    borderColor: colors.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Feather name="upload" size={16} color={colors.foreground} />
                <Text style={[styles.importBtnText, { color: colors.foreground }]}>
                  Import Spec Sheet…
                </Text>
              </Pressable>
            </>
          ) : null}
        </CardSection>

        {/* Saved spec sheets: cross-reference against current recipes */}
        <SectionHeader title="Spec Sheet Cross-Reference" />
        <CardSection>
          <Text style={[styles.pinHint, { color: colors.mutedForeground }]}>
            Your two most recently imported spec sheets are saved here. Cross-reference
            all at once to see which recipes match, or check a single sheet for an AI summary.
          </Text>

          {/* Cross-reference all button */}
          {!sheetsLoading && savedSheets.length > 0 && (
            <Pressable
              onPress={handleCheckAll}
              disabled={reconAllBusy || sheetBusyId !== null}
              style={({ pressed }) => [
                styles.importBtn,
                {
                  backgroundColor: colors.primary,
                  opacity: reconAllBusy || sheetBusyId !== null || pressed ? 0.7 : 1,
                  marginBottom: 8,
                },
              ]}
            >
              <Text style={[styles.importBtnText, { color: colors.primaryForeground }]}>
                {reconAllBusy ? "Checking…" : "Cross-reference all"}
              </Text>
            </Pressable>
          )}

          {sheetsLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : savedSheets.length === 0 ? (
            <Text style={[styles.pinHint, { color: colors.mutedForeground, marginBottom: 0 }]}>
              No saved spec sheets yet. Import a spec sheet and it will appear here.
            </Text>
          ) : (
            savedSheets.map((s) => (
              <View
                key={s.id}
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 8,
                  gap: 8,
                }}
              >
                <Text style={{ fontSize: 14, fontFamily: FONTS.medium, color: colors.foreground }}>
                  {s.label}
                </Text>
                <Text style={{ fontSize: 12, color: colors.mutedForeground }}>
                  Imported {new Date(s.createdAt).toLocaleString()}
                </Text>
                {/* Import-time flavor corrections; extracted component so the
                    web-side regression test can guard it (see component). */}
                <SpecSheetWarningsCallout
                  sheet={s}
                  expanded={warnExpandedIds.has(s.id)}
                  onToggle={() =>
                    setWarnExpandedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(s.id)) next.delete(s.id);
                      else next.add(s.id);
                      return next;
                    })
                  }
                  colors={colors}
                />
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  <Pressable
                    onPress={() => handleCheckSheet(s.id)}
                    disabled={sheetBusyId !== null || reconAllBusy}
                    style={({ pressed }) => [
                      styles.importBtn,
                      {
                        backgroundColor: colors.secondary,
                        borderWidth: 1,
                        borderColor: colors.border,
                        opacity: sheetBusyId !== null || reconAllBusy || pressed ? 0.7 : 1,
                        flex: 1,
                      },
                    ]}
                  >
                    <Text style={[styles.importBtnText, { color: colors.foreground }]}>
                      {sheetBusyId === s.id ? "Checking…" : "AI summary"}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleDeleteSheet(s.id)}
                    disabled={sheetBusyId !== null || reconAllBusy}
                    style={({ pressed }) => [
                      styles.importBtn,
                      {
                        backgroundColor: colors.secondary,
                        borderWidth: 1,
                        borderColor: colors.border,
                        opacity: sheetBusyId !== null || reconAllBusy || pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Text style={[styles.importBtnText, { color: colors.foreground }]}>
                      Delete
                    </Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}

          {reconError ? (
            <Text style={{ fontSize: 13, color: colors.destructive, marginTop: 4 }}>
              {reconError}
            </Text>
          ) : null}

          {/* Combined cross-reference view */}
          {reconAllEntries ? (
            <View style={{ gap: 12, marginTop: 4 }}>
              {/* Summary badges */}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {(() => {
                  const covered = reconAllEntries.filter(r => r.inLibrary && r.coverage.length > 0).length;
                  const issues = reconAllEntries.filter(r => r.coverage.some(c => c.discrepancies.length > 0)).length;
                  const uncovered = reconAllEntries.filter(r => r.inLibrary && r.coverage.length === 0).length;
                  const specOnly = reconAllEntries.filter(r => !r.inLibrary).length;
                  return (
                    <>
                      <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, backgroundColor: colors.muted }}>
                        <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{covered} matched</Text>
                      </View>
                      {issues > 0 && (
                        <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, backgroundColor: "#7f1d1d40" }}>
                          <Text style={{ fontSize: 11, color: "#f87171" }}>{issues} with issues</Text>
                        </View>
                      )}
                      {uncovered > 0 && (
                        <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, borderWidth: 1, borderColor: colors.border }}>
                          <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{uncovered} not in any spec</Text>
                        </View>
                      )}
                      {specOnly > 0 && (
                        <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, borderWidth: 1, borderColor: colors.border }}>
                          <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{specOnly} spec-only</Text>
                        </View>
                      )}
                      {issues === 0 && specOnly === 0 && uncovered === 0 && (
                        <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, backgroundColor: "#05301440" }}>
                          <Text style={{ fontSize: 11, color: "#4ade80" }}>All recipes match</Text>
                        </View>
                      )}
                    </>
                  );
                })()}
              </View>

              {/* Recipe-centric grouped list */}
              {MOBILE_KIND_ORDER.map((kind) => {
                const recipes = reconAllEntries.filter(r => r.kind === kind);
                if (recipes.length === 0) return null;
                return (
                  <View key={kind}>
                    <Text style={{ fontSize: 11, fontFamily: FONTS.semibold, color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>
                      {MOBILE_KIND_LABELS[kind]}
                    </Text>
                    <View style={{ gap: 4 }}>
                      {recipes.map((recipe) => {
                        const allDiscs = recipe.coverage.flatMap(c => c.discrepancies);
                        const status = !recipe.inLibrary ? "spec-only" : recipe.coverage.length === 0 ? "uncovered" : allDiscs.length > 0 ? "issues" : "match";
                        const dotColor = status === "match" ? "#4ade80" : status === "issues" ? "#f59e0b" : status === "spec-only" ? "#60a5fa" : colors.mutedForeground;
                        return (
                          <View key={`${recipe.kind}\0${recipe.name}`} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 6, padding: 10, gap: 4 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor, flexShrink: 0 }} />
                              <Text style={{ flex: 1, fontSize: 13, fontFamily: FONTS.medium, color: colors.foreground }}>{recipe.name}</Text>
                              {status === "issues" && (
                                <Text style={{ fontSize: 11, color: "#f87171" }}>{allDiscs.length} diff{allDiscs.length !== 1 ? "s" : ""}</Text>
                              )}
                              {status === "uncovered" && (
                                <Text style={{ fontSize: 11, color: colors.mutedForeground }}>Not in any spec</Text>
                              )}
                              {status === "spec-only" && (
                                <Text style={{ fontSize: 11, color: "#93c5fd" }}>Not in library</Text>
                              )}
                            </View>
                            {status === "issues" && allDiscs.map((d, i) => (
                              <Text key={i} style={{ fontSize: 11, color: colors.mutedForeground, paddingLeft: 16 }}>— {d.message}</Text>
                            ))}
                            {status === "spec-only" && (
                              <Text style={{ fontSize: 11, color: colors.mutedForeground, paddingLeft: 16 }}>
                                On the spec sheet but not in your recipe library.
                              </Text>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}

          {/* AI summary result for individual sheet */}
          {reconResult ? (
            <View
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 8,
                padding: 12,
                marginTop: 4,
                gap: 8,
              }}
            >
              <Text style={{ fontSize: 14, fontFamily: FONTS.bold, color: colors.foreground }}>
                {reconResult.discrepancies.length === 0
                  ? "Everything matches"
                  : `${reconResult.discrepancies.length} difference${
                      reconResult.discrepancies.length === 1 ? "" : "s"
                    }`}
              </Text>
              {reconResult.summary ? (
                <Text style={{ fontSize: 13, color: colors.foreground }}>
                  {reconResult.summary}
                </Text>
              ) : null}
              {reconResult.discrepancies.length === 0 ? (
                <Text style={{ fontSize: 13, color: colors.mutedForeground }}>
                  Every recipe on this spec sheet matches your current recipes exactly.
                </Text>
              ) : (
                reconResult.discrepancies.map((d, i) => (
                  <Text key={i} style={{ fontSize: 13, color: colors.mutedForeground }}>
                    <Text style={{ fontFamily: FONTS.medium, color: colors.foreground }}>
                      {d.kind} · {d.recipeName}
                    </Text>
                    {" — "}
                    {d.message}
                  </Text>
                ))
              )}
            </View>
          ) : null}
        </CardSection>

        {/* Brands & flavors */}
        <SectionHeader title="Brands & Flavors" />
        <CardSection>
          <ListManager
            items={brands}
            placeholder="Add brand…"
            onAdd={(v) => addListItem("brands", v)}
            onRemove={(v) => removeListItem("brands", v)}
            onRename={renameBrand}
          />
          {brands.map((brand) => (
            <View key={brand} style={styles.brandBlock}>
              <Text style={[styles.brandName, { color: colors.foreground }]}>
                {brand}
              </Text>
              <ListManager
                items={brandFlavors[brand] ?? []}
                placeholder={`Add flavor for ${brand}…`}
                onAdd={(v) => addFlavor(brand, v)}
                onRemove={(v) => removeFlavor(brand, v)}
                onRename={(oldF, newF) => renameFlavor(brand, oldF, newF)}
              />
            </View>
          ))}
        </CardSection>

        {/* Die types */}
        <SectionHeader title="Die Types" />
        <CardSection>
          <ListManager
            items={dieTypes}
            placeholder="Add die type…"
            {...simpleList("dieTypes")}
          />
        </CardSection>

        {/* Pepperoni types */}
        <SectionHeader title="Pepperoni Types" />
        <CardSection>
          <ListManager
            items={pepTypes}
            placeholder="Add pepperoni type…"
            {...simpleList("pepTypes")}
          />
        </CardSection>

        {/* Cheese ingredients */}
        <SectionHeader title="Cheese Ingredients" />
        <CardSection>
          <ListManager
            items={cheeseIngredients}
            placeholder="Add cheese ingredient…"
            {...simpleList("cheeseIngredients")}
          />
        </CardSection>

        {/* Dough ingredients */}
        <SectionHeader title="Dough Ingredients" />
        <CardSection>
          <ListManager
            items={doughIngredients}
            placeholder="Add dough ingredient…"
            {...simpleList("doughIngredients")}
          />
        </CardSection>

        {/* Frontline ingredients */}
        <SectionHeader title="Frontline Ingredients" />
        <CardSection>
          <ListManager
            items={frontlineIngredients}
            placeholder="Add frontline ingredient…"
            {...simpleList("frontlineIngredients")}
          />
        </CardSection>

        {/* Stop reasons */}
        <SectionHeader title="Stop Reasons" />
        <CardSection>
          <ListManager
            items={stopReasons}
            placeholder="Add stop reason…"
            {...simpleList("stopReasons")}
          />
        </CardSection>

        {/* My mix recipes */}
        <SectionHeader title="My Mix Recipes" />
        <CardSection>
          <Text style={[styles.pinHint, { color: colors.mutedForeground }]}>
            Saved from the Setup tab&apos;s mix editor. Tap a name to rename.
          </Text>
          {mixNames.length === 0 ? (
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              None yet — save one with “Save as mix” in the Setup tab.
            </Text>
          ) : (
            <ListManager
              items={mixNames}
              placeholder=""
              hideAdd
              onAdd={() => {}}
              onRemove={(v) => deleteRecipePreset("mix", v)}
              onRename={(oldName, newName) =>
                renameRecipePreset("mix", oldName, newName)
              }
            />
          )}
        </CardSection>

        {/* Production rules (edit-production-rules capability; mirrors web) */}
        {canEditRules ? (
          <>
            <SectionHeader title="Rules" />
            <CardSection>
              <ProductionRulesManager />
            </CardSection>
          </>
        ) : null}

        {/* Freezer-pull items (manage-inventory capability; mirrors web) */}
        {canManageInventory ? (
          <>
            <SectionHeader title="Freezer Pull" />
            <CardSection>
              <FreezerPullItemsManager
                suggestions={[
                  ...doughIngredients,
                  ...frontlineIngredients,
                  ...cheeseIngredients,
                  ...pepTypes,
                ]}
              />
            </CardSection>
          </>
        ) : null}

        {/* Mixes (manage-inventory capability; mirrors web) */}
        {canManageInventory ? (
          <>
            <SectionHeader title="Mixes" />
            <CardSection>
              {isManager ? (
                <>
                  <Text style={[styles.pinHint, { color: colors.mutedForeground }]}>
                    Import premix sheets from an Excel (.xlsx) workbook. Each
                    product tab becomes a mix; you&apos;ll see a summary before
                    anything is saved. Re-importing updates existing mixes instead
                    of duplicating.
                  </Text>
                  <Pressable
                    onPress={handlePremixImportPick}
                    style={({ pressed }) => [
                      styles.importBtn,
                      {
                        backgroundColor: colors.secondary,
                        borderWidth: 1,
                        borderColor: colors.border,
                        opacity: pressed ? 0.7 : 1,
                        marginBottom: 12,
                      },
                    ]}
                  >
                    <Feather name="upload" size={16} color={colors.foreground} />
                    <Text style={[styles.importBtnText, { color: colors.foreground }]}>
                      Import Premix Sheet…
                    </Text>
                  </Pressable>
                </>
              ) : null}
              <MixesManager
                brands={brands}
                brandFlavors={brandFlavors}
                ingredientSuggestions={[
                  ...doughIngredients,
                  ...frontlineIngredients,
                  ...cheeseIngredients,
                  ...pepTypes,
                ]}
              />
            </CardSection>

            <SectionHeader title="Mix Monitoring" />
            <CardSection>
              <MixReconcilePanel isManager={isManager} />
            </CardSection>

            <SectionHeader title="Ask about Mixes" />
            <CardSection>
              <MixAssistChat />
            </CardSection>
          </>
        ) : null}

        {/* Cycle-count schedules (manage-inventory capability; mirrors web) */}
        {canManageInventory ? (
          <>
            <SectionHeader title="Cycle Counts" />
            <CardSection>
              <CycleCountManager suggestions={DEFAULT_CYCLE_COUNT_SECTIONS} />
            </CardSection>
          </>
        ) : null}

        {/* Staff & roles: roster + role assignment + reset approvals (StaffRolesCard)
            and the role/capability editor (RolesManager). Each card self-gates on
            the precise capability; the section shows for either. */}
        {canManageStaff || canApproveResets ? (
          <>
            <SectionHeader title="Staff" />
            <StaffRolesCard />
            <RolesManager />
          </>
        ) : null}

        {/* Merge ingredients */}
        <SectionHeader title="Merge Ingredients" />
        <CardSection>
          <MergeManager autoSuggest={mergeCheckSignal} />
        </CardSection>

        {/* Supervisor PIN */}
        <SectionHeader title="Supervisor PIN" />
        <CardSection>
          <Text style={[styles.pinHint, { color: colors.mutedForeground }]}>
            {supervisorPin
              ? "A PIN is set. Enter a new one to change it, or clear it."
              : "No PIN set. The Setup tab is unlocked."}
          </Text>
          <View style={styles.addRow}>
            <TextInput
              style={[
                styles.input,
                { color: colors.foreground, borderColor: colors.border },
              ]}
              value={pinDraft}
              onChangeText={setPinDraft}
              placeholder="New PIN (digits)"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={8}
            />
            <Pressable
              onPress={() => {
                const next = pinDraft.trim();
                setPinMsg("");
                setSupervisorPin(next)
                  .then(() => {
                    setPinDraft("");
                    setPinMsg("PIN updated.");
                    Haptics.notificationAsync(
                      Haptics.NotificationFeedbackType.Success,
                    );
                  })
                  .catch((err: unknown) => {
                    setPinMsg(
                      err instanceof Error && /\b403\b/.test(err.message)
                        ? "Only a manager can change the supervisor PIN."
                        : "Couldn't update the PIN. Check your connection.",
                    );
                  });
              }}
              disabled={!pinDraft.trim()}
              style={({ pressed }) => [
                styles.pinSaveBtn,
                {
                  backgroundColor: colors.primary,
                  opacity: !pinDraft.trim() ? 0.4 : pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text
                style={[styles.pinSaveText, { color: colors.primaryForeground }]}
              >
                Set
              </Text>
            </Pressable>
          </View>
          {supervisorPin ? (
            <Pressable
              onPress={() => {
                setPinMsg("");
                setSupervisorPin("")
                  .then(() => {
                    setPinMsg("PIN removed — settings are now unlocked.");
                    tap();
                  })
                  .catch((err: unknown) => {
                    setPinMsg(
                      err instanceof Error && /\b403\b/.test(err.message)
                        ? "Only a manager can change the supervisor PIN."
                        : "Couldn't update the PIN. Check your connection.",
                    );
                  });
              }}
              style={({ pressed }) => [
                styles.clearPinBtn,
                { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Feather name="unlock" size={14} color={colors.foreground} />
              <Text style={[styles.clearPinText, { color: colors.foreground }]}>
                Remove PIN lock
              </Text>
            </Pressable>
          ) : null}
          {pinMsg ? (
            <Text style={[styles.pinHint, { color: colors.mutedForeground }]}>
              {pinMsg}
            </Text>
          ) : null}
        </CardSection>

        {/* Recent changes — local-only undo trail of master-data edits */}
        <SectionHeader title="Recent Changes" />
        <CardSection>
          <Text style={[styles.pinHint, { color: colors.mutedForeground }]}>
            Edits to lists, recipes, and merges on this device. Undo rolls back
            that change and any made after it. Stored locally — not synced.
          </Text>
          {changeHistory.length === 0 ? (
            <Text style={[styles.previewSub, { color: colors.mutedForeground }]}>
              No changes yet.
            </Text>
          ) : (
            changeHistory.map((entry) => (
              <View
                key={entry.id}
                style={[styles.historyRow, { borderColor: colors.border }]}
              >
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={[styles.historyDesc, { color: colors.foreground }]}>
                    {entry.description}
                  </Text>
                  <Text
                    style={[styles.previewSub, { color: colors.mutedForeground }]}
                  >
                    {new Date(entry.ts).toLocaleString()}
                  </Text>
                </View>
                <Pressable
                  onPress={() => confirmUndoChange(entry)}
                  style={({ pressed }) => [
                    styles.suggestActionBtn,
                    { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <Text
                    style={[styles.suggestActionText, { color: colors.foreground }]}
                  >
                    Undo
                  </Text>
                </Pressable>
              </View>
            ))
          )}
        </CardSection>
      </KeyboardAwareScrollViewCompat>

      <SpecImportModal
        visible={specOpen}
        onClose={() => {
          setSpecOpen(false);
          setSpecPrepared(null);
          setSpecError(null);
        }}
        loading={specLoading}
        progress={specProgress}
        error={specError}
        prepared={specPrepared}
        applying={specApplying}
        onConfirm={handleSpecImportConfirm}
      />

      <PremixImportModal
        visible={premixOpen}
        onClose={() => {
          setPremixOpen(false);
          setPremixPrepared(null);
          setPremixError(null);
        }}
        loading={premixLoading}
        progress={premixProgress}
        error={premixError}
        prepared={premixPrepared}
        applying={premixApplying}
        onConfirm={handlePremixImportConfirm}
      />

      <ExcelImportModal
        visible={importOpen}
        onClose={() => {
          setImportOpen(false);
          setImportResult(null);
        }}
        result={importResult}
        brands={brands}
        brandFlavors={brandFlavors}
        supervisorPin={supervisorPin}
        defaultDate={todayStr()}
        onConfirm={commitExcelImport}
      />
    </>
  );
}

const styles = StyleSheet.create({
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  empty: { fontSize: 13, fontStyle: "italic" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: { fontSize: 13, fontFamily: FONTS.medium },
  importBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 10,
  },
  importBtnText: { fontSize: 14, fontFamily: FONTS.medium },
  editRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexGrow: 1,
    flexBasis: "100%",
  },
  editInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 13,
    fontFamily: FONTS.regular,
  },
  editIconBtn: { padding: 6 },
  addRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    fontFamily: FONTS.regular,
  },
  addBtn: {
    width: 44,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  brandBlock: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(127,127,127,0.3)",
    gap: 8,
  },
  brandName: { fontSize: 15, fontFamily: FONTS.bold },
  pinHint: { fontSize: 12, marginBottom: 10 },
  pinSaveBtn: {
    paddingHorizontal: 18,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  pinSaveText: { fontSize: 14, fontFamily: FONTS.semibold },
  clearPinBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 9,
    marginTop: 12,
  },
  clearPinText: { fontSize: 13, fontFamily: FONTS.semibold },
  mergeLabel: {
    fontSize: 11,
    fontFamily: FONTS.semibold,
    letterSpacing: 0.6,
  },
  targetChip: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  targetChipText: { fontSize: 12, fontFamily: FONTS.medium },
  catTab: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  catTabText: { fontSize: 12, fontFamily: FONTS.medium },
  mergeError: { fontSize: 12, fontFamily: FONTS.medium },
  previewBox: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  previewText: { fontSize: 13, fontFamily: FONTS.regular },
  previewSub: { fontSize: 11, fontFamily: FONTS.regular },
  mergeBtn: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  mergeBtnText: { fontSize: 14, fontFamily: FONTS.semibold },
  suggestBox: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  suggestHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  suggestTitle: { fontSize: 13, fontFamily: FONTS.semibold },
  suggestBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minWidth: 96,
    alignItems: "center",
    justifyContent: "center",
  },
  suggestBtnText: { fontSize: 12, fontFamily: FONTS.semibold },
  suggestItem: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  suggestActionBtn: {
    flex: 1,
    height: 32,
    borderWidth: 1,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  suggestActionText: { fontSize: 12, fontFamily: FONTS.medium },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  historyDesc: { fontSize: 13, fontFamily: FONTS.medium, marginBottom: 2 },
});
