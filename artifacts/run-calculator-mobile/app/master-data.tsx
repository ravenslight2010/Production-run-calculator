import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as Haptics from "expo-haptics";
import { Stack } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import ExcelImportModal, { type ImportCommit } from "@/components/ExcelImportModal";
import ProductionRulesManager from "@/components/ProductionRulesManager";
import FreezerPullItemsManager from "@/components/FreezerPullItemsManager";
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
  type ImportParseResult,
} from "@/utils/runExcel";
import {
  buildMergeMap,
  countMergeReferences,
  type MergeMap,
} from "@/context/mergeIngredients";
import { scoreNameMatch } from "@/context/inventoryShared";
import { suggestMerges, denyMerge, type ReviewedMergeSuggestion } from "@/context/mergeSuggest";
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
  fetchSavedSpecSheets,
  reconcileSpecSheet,
  deleteSpecSheet,
  presetMapsToReconcileRecipes,
  type SavedSpecSheet,
  type SpecReconcileResult,
} from "@/context/savedSpecSheets";
import { useColors } from "@/hooks/useColors";
import { useMe } from "@/hooks/useRole";
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
  } = useRun();

  const [sources, setSources] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // AI + learned-memory merge suggestions (reviewed before applying).
  const [suggestions, setSuggestions] = useState<ReviewedMergeSuggestion[]>([]);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [suggestError, setSuggestError] = useState("");
  const [suggestNote, setSuggestNote] = useState("");
  const [suggestRan, setSuggestRan] = useState(false);
  // True when this scan was kicked off automatically by a recipe import, so we
  // can explain to the user why suggestions appeared.
  const [fromImport, setFromImport] = useState(false);

  // The mergeable universe: master-data lists whose values a merge rewrites —
  // ingredient names plus die types (the `dieType` selection field is rewritten
  // too). Brands/flavors are excluded (separate rename path). (Mobile has no
  // separate ingredientTypes/mixIngredients lists.)
  const universe = React.useMemo(() => {
    const all = [
      ...pepTypes,
      ...cheeseIngredients,
      ...doughIngredients,
      ...frontlineIngredients,
      ...dieTypes,
    ];
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
  }, [pepTypes, cheeseIngredients, doughIngredients, frontlineIngredients, dieTypes]);

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
    setSuggestBusy(true);
    setSuggestError("");
    setSuggestNote("");
    setSuggestRan(true);
    try {
      const { suggestions: out, usedAi, error: err } = await suggestMerges(universe);
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
    setFromImport(true);
    void suggest(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSuggest]);

  const loadSuggestion = (s: ReviewedMergeSuggestion) => {
    setError("");
    setConfirming(false);
    setFromImport(false);
    // Snap names to the universe's exact spelling so the source rows actually
    // select (AI/learned suggestion names can differ in case). Mirrors web.
    const canon = (n: string) =>
      universe.find((u) => u.toLowerCase() === n.trim().toLowerCase()) ?? n.trim();
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
      await mergeIngredients(srcs, s.target);
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
  // suggester never proposes them again (factory-wide), then drop it locally.
  // Best-effort persistence — the suggestion is hidden either way (web parity).
  const ignoreSuggestion = async (s: ReviewedMergeSuggestion) => {
    const srcs = s.sources.filter((n) => n !== s.target);
    if (srcs.length === 0) return;
    setFromImport(false);
    setSuggestions((prev) => prev.filter((x) => x !== s));
    try {
      await denyMerge(s.target, srcs);
    } catch {
      // Non-fatal: hidden for this session; may reappear later if it didn't persist.
    }
  };

  const apply = async () => {
    if (!hasMerge) {
      setError("Pick at least one source and a different target.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await mergeIngredients(sources, target);
      reset();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Merge failed. Please try again.");
    }
  };

  if (universe.length === 0) {
    return (
      <Text style={[styles.empty, { color: colors.mutedForeground }]}>
        No ingredients to merge yet.
      </Text>
    );
  }

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

      <Text style={[styles.pinHint, { color: colors.mutedForeground, marginBottom: 0 }]}>
        Combine duplicate or similar ingredients into one. Pick the ingredient(s) to
        merge away, then the one to keep. Every recipe, list, preset, profile, run,
        template and history entry is updated, and inventory stock is folded into the
        target. This can&apos;t be undone.
      </Text>

      {/* AI + learned-memory suggestions: scan for duplicate groups, review
          before merging. */}
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
            {previewCount} reference{previewCount === 1 ? "" : "s"} will be updated.
            Inventory stock for merged items folds into the target.
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
    </View>
  );
}

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
  } = useRun();
  const { isManager, hasCapability } = useMe();
  const canEditRules = hasCapability("edit-production-rules");
  const canManageInventory = hasCapability("manage-inventory");
  const canManageStaff = hasCapability("manage-staff");
  const canApproveResets = hasCapability("approve-password-resets");

  const [pinDraft, setPinDraft] = useState("");
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
      // ignore — user can retry
    }
  }

  function commitExcelImport(payload: ImportCommit) {
    payload.createBrands.forEach((b) => addListItem("brands", b));
    payload.createFlavors.forEach((cf) => addFlavor(cf.brand, cf.flavor));
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
      importScheduledRuns(byDate);
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
    }
    setImportOpen(false);
    setImportResult(null);
  }
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
    Alert.alert(
      "Undo change",
      `Undo "${entry.description}"${tail}?${warn}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Undo",
          style: "destructive",
          onPress: () => {
            undoMasterDataChange(entry.id);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          },
        },
      ],
    );
  };

  // ── Excel spec-sheet import (manager only; mirrors the web header action) ──
  const [specOpen, setSpecOpen] = useState(false);
  const [specLoading, setSpecLoading] = useState(false);
  const [specApplying, setSpecApplying] = useState(false);
  const [specError, setSpecError] = useState<string | null>(null);
  const [specPrepared, setSpecPrepared] = useState<SpecImportPrepared | null>(null);
  const [specProgress, setSpecProgress] = useState<{ done: number; total: number } | null>(null);
  // Bumped after a recipe import to make MergeManager auto-run a merge check
  // (imported recipe ingredients can duplicate standalone individual ones).
  const [mergeCheckSignal, setMergeCheckSignal] = useState(0);

  // ── Saved spec sheets: cross-reference against current recipes ──
  const [savedSheets, setSavedSheets] = useState<SavedSpecSheet[]>([]);
  const [sheetsLoading, setSheetsLoading] = useState(true);
  const [sheetBusyId, setSheetBusyId] = useState<number | null>(null);
  const [reconResult, setReconResult] = useState<SpecReconcileResult | null>(null);
  const [reconError, setReconError] = useState<string | null>(null);

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

  function handleDeleteSheet(id: number) {
    Alert.alert("Delete saved spec sheet?", "This removes the saved snapshot.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
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
      },
    ]);
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
        dieTypes,
      },
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
        prepared = await prepareSpecImportMulti(settled, store, (done, total) =>
          setSpecProgress({ done, total }),
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
    } catch (e) {
      setSpecError(
        e instanceof Error ? e.message : "Could not apply the import. Please retry.",
      );
    } finally {
      setSpecApplying(false);
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
        <SectionHeader title="Saved Spec Sheets" />
        <CardSection>
          <Text style={[styles.pinHint, { color: colors.mutedForeground }]}>
            Your two most recently imported spec sheets are saved here.
            Cross-reference one against your current recipes to see whether the
            recipes still match the spec.
          </Text>
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
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  <Pressable
                    onPress={() => handleCheckSheet(s.id)}
                    disabled={sheetBusyId !== null}
                    style={({ pressed }) => [
                      styles.importBtn,
                      {
                        backgroundColor: colors.primary,
                        opacity: sheetBusyId !== null || pressed ? 0.7 : 1,
                        flex: 1,
                      },
                    ]}
                  >
                    <Text style={[styles.importBtnText, { color: colors.primaryForeground }]}>
                      {sheetBusyId === s.id ? "Checking…" : "Check against recipes"}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleDeleteSheet(s.id)}
                    disabled={sheetBusyId !== null}
                    style={({ pressed }) => [
                      styles.importBtn,
                      {
                        backgroundColor: colors.secondary,
                        borderWidth: 1,
                        borderColor: colors.border,
                        opacity: sheetBusyId !== null || pressed ? 0.7 : 1,
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
                setSupervisorPin(pinDraft.trim());
                setPinDraft("");
                Haptics.notificationAsync(
                  Haptics.NotificationFeedbackType.Success,
                );
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
                setSupervisorPin("");
                tap();
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
