import { Feather } from "@expo/vector-icons";
import React from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { useMe } from "@/hooks/useRole";
import {
  exactMatch,
  fuzzyMatch,
  mergeImportRuns,
  type ImportParseResult,
} from "@/utils/runExcel";
import { requestMatchImport } from "@/context/matchImport";

const SKIP = "";
const CREATE = "__create__";
// Tint for AI-suggested match chips (distinct from primary/create/skip).
const AI_TINT = "#8b5cf6";

export type ImportCommit = {
  date: string;
  runs: { brand: string; flavor: string; casesPlanned: number; notes: string }[];
  createBrands: string[];
  createFlavors: { brand: string; flavor: string }[];
};

type Props = {
  visible: boolean;
  onClose: () => void;
  result: ImportParseResult | null;
  brands: string[];
  brandFlavors: Record<string, string[]>;
  supervisorPin: string;
  defaultDate: string;
  onConfirm: (payload: ImportCommit) => void;
};

export default function ExcelImportModal({
  visible,
  onClose,
  result,
  brands,
  brandFlavors,
  supervisorPin,
  defaultDate,
  onConfirm,
}: Props) {
  const colors = useColors();
  // Managers (server role) bypass the device PIN; operators still need it.
  const { isManager } = useMe();
  const [date, setDate] = React.useState(defaultDate);
  const [brandChoice, setBrandChoice] = React.useState<Record<string, string>>({});
  const [flavorChoice, setFlavorChoice] = React.useState<Record<string, string>>({});
  const [unlocked, setUnlocked] = React.useState(false);
  const [pinEntry, setPinEntry] = React.useState("");
  // AI-suggested matches for names that did not exactly match (best-effort; the
  // modal still works without them via the Levenshtein fuzzy chips).
  const [aiBrandMatch, setAiBrandMatch] = React.useState<Record<string, string>>({});
  const [aiFlavorMatch, setAiFlavorMatch] = React.useState<Record<string, string>>({});
  const [aiLoading, setAiLoading] = React.useState(false);
  // Candidate keys already sent to the AI, so the brand->flavor cascade does not
  // refetch the same names repeatedly.
  const aiRequestedBrands = React.useRef<Set<string>>(new Set());
  const aiRequestedFlavors = React.useRef<Set<string>>(new Set());

  const canCreate = !supervisorPin || unlocked || isManager;
  const rows = result?.rows ?? [];
  const errors = result?.errors ?? [];

  // Initialise brand resolution defaults whenever a new file is parsed.
  React.useEffect(() => {
    if (!result) return;
    setDate(defaultDate);
    setUnlocked(false);
    setPinEntry("");
    const bc: Record<string, string> = {};
    for (const r of result.rows) {
      const key = r.brand.toLowerCase();
      if (bc[key] !== undefined) continue;
      bc[key] = exactMatch(r.brand, brands) ?? SKIP;
    }
    setBrandChoice(bc);
    setFlavorChoice({});
  }, [result, defaultDate, brands]);

  const resolveBrandName = React.useCallback(
    (candidate: string): string | null => {
      const choice = brandChoice[candidate.toLowerCase()] ?? SKIP;
      if (choice === CREATE) return candidate;
      if (choice === SKIP) return null;
      return choice;
    },
    [brandChoice],
  );

  // Initialise flavor resolution defaults for the current resolved brands.
  React.useEffect(() => {
    if (!result) return;
    setFlavorChoice((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const r of result.rows) {
        if (!r.flavor) continue;
        const brandName = resolveBrandName(r.brand);
        if (!brandName) continue;
        const key = `${brandName.toLowerCase()}|||${r.flavor.toLowerCase()}`;
        if (next[key] !== undefined) continue;
        const opts = brandFlavors[brandName] ?? [];
        next[key] = exactMatch(r.flavor, opts) ?? SKIP;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [result, brandChoice, brandFlavors, resolveBrandName]);

  // Reset AI state whenever a new file is parsed.
  React.useEffect(() => {
    aiRequestedBrands.current = new Set();
    aiRequestedFlavors.current = new Set();
    setAiBrandMatch({});
    setAiFlavorMatch({});
    setAiLoading(false);
  }, [result]);

  // Ask the AI to match still-unmatched brand/flavor names against the saved
  // ones. Runs again as brands resolve (exposing more flavors); a per-candidate
  // ref guard prevents refetching the same names. Best-effort: any failure
  // (offline, not a manager, rate-limited) is swallowed and the user falls back
  // to the fuzzy chips.
  React.useEffect(() => {
    if (!result) return;
    const newBrands: string[] = [];
    const seenB = new Set<string>();
    for (const r of result.rows) {
      const k = r.brand.toLowerCase();
      if (seenB.has(k)) continue;
      seenB.add(k);
      if (exactMatch(r.brand, brands)) continue;
      if (aiRequestedBrands.current.has(k)) continue;
      newBrands.push(r.brand);
    }
    const newFlavors: { brand: string; flavor: string }[] = [];
    const seenF = new Set<string>();
    for (const r of result.rows) {
      if (!r.flavor) continue;
      const brandName = resolveBrandName(r.brand);
      if (!brandName) continue;
      const opts = brandFlavors[brandName] ?? [];
      if (exactMatch(r.flavor, opts)) continue;
      const key = `${brandName.toLowerCase()}|||${r.flavor.toLowerCase()}`;
      if (seenF.has(key)) continue;
      seenF.add(key);
      if (aiRequestedFlavors.current.has(key)) continue;
      newFlavors.push({ brand: brandName, flavor: r.flavor });
    }
    if (newBrands.length === 0 && newFlavors.length === 0) return;
    newBrands.forEach((b) => aiRequestedBrands.current.add(b.toLowerCase()));
    newFlavors.forEach((f) =>
      aiRequestedFlavors.current.add(`${f.brand.toLowerCase()}|||${f.flavor.toLowerCase()}`),
    );

    let cancelled = false;
    setAiLoading(true);
    requestMatchImport({ brands, brandFlavors, unmatchedBrands: newBrands, unmatchedFlavors: newFlavors })
      .then((r) => {
        if (cancelled) return;
        if (r.brandMatches.length) {
          setAiBrandMatch((p) => {
            const next = { ...p };
            for (const m of r.brandMatches) next[m.candidate.toLowerCase()] = m.match;
            return next;
          });
        }
        if (r.flavorMatches.length) {
          setAiFlavorMatch((p) => {
            const next = { ...p };
            for (const m of r.flavorMatches) {
              next[`${m.brand.toLowerCase()}|||${m.candidate.toLowerCase()}`] = m.match;
            }
            return next;
          });
        }
      })
      .catch(() => {
        /* best-effort; fall back to fuzzy chips */
      })
      .finally(() => {
        if (!cancelled) setAiLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [result, brandChoice, brands, brandFlavors, resolveBrandName]);

  // Apply AI brand matches to choices still at SKIP (never clobber a user pick).
  React.useEffect(() => {
    if (Object.keys(aiBrandMatch).length === 0) return;
    setBrandChoice((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [k, v] of Object.entries(aiBrandMatch)) {
        if ((next[k] ?? SKIP) === SKIP && brands.includes(v)) {
          next[k] = v;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [aiBrandMatch, brands]);

  // Apply AI flavor matches to choices still at SKIP (never clobber a user pick).
  React.useEffect(() => {
    if (Object.keys(aiFlavorMatch).length === 0) return;
    setFlavorChoice((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [k, v] of Object.entries(aiFlavorMatch)) {
        if ((next[k] ?? SKIP) === SKIP) {
          next[k] = v;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [aiFlavorMatch]);

  if (!visible) return null;

  const uniqueBrands: string[] = [];
  const seenB = new Set<string>();
  for (const r of rows) {
    const k = r.brand.toLowerCase();
    if (seenB.has(k)) continue;
    seenB.add(k);
    if (!exactMatch(r.brand, brands)) uniqueBrands.push(r.brand);
  }

  type FlavorItem = { brandName: string; flavor: string; key: string };
  const uniqueFlavors: FlavorItem[] = [];
  const seenF = new Set<string>();
  for (const r of rows) {
    if (!r.flavor) continue;
    const brandName = resolveBrandName(r.brand);
    if (!brandName) continue;
    const opts = brandFlavors[brandName] ?? [];
    if (exactMatch(r.flavor, opts)) continue;
    const key = `${brandName.toLowerCase()}|||${r.flavor.toLowerCase()}`;
    if (seenF.has(key)) continue;
    seenF.add(key);
    uniqueFlavors.push({ brandName, flavor: r.flavor, key });
  }

  // Merge the AI-suggested value into the fuzzy chip list (dedup, AI first) and
  // flag which value is the AI pick so it can be tinted differently.
  const chipValues = (
    aiVal: string | undefined,
    fuzzy: { value: string }[],
  ): { value: string; ai: boolean }[] => {
    const seen = new Set<string>();
    const out: { value: string; ai: boolean }[] = [];
    if (aiVal) {
      out.push({ value: aiVal, ai: true });
      seen.add(aiVal.toLowerCase());
    }
    for (const s of fuzzy) {
      if (seen.has(s.value.toLowerCase())) continue;
      seen.add(s.value.toLowerCase());
      out.push({ value: s.value, ai: false });
    }
    return out;
  };

  function buildCommit(): ImportCommit {
    const createBrands = new Set<string>();
    const createFlavors = new Map<string, { brand: string; flavor: string }>();
    const out: ImportCommit["runs"] = [];
    for (const r of rows) {
      const brandName = resolveBrandName(r.brand);
      if (!brandName) continue;
      if ((brandChoice[r.brand.toLowerCase()] ?? SKIP) === CREATE) createBrands.add(brandName);
      let flavorName = "";
      if (r.flavor) {
        const key = `${brandName.toLowerCase()}|||${r.flavor.toLowerCase()}`;
        const fc = flavorChoice[key] ?? SKIP;
        if (fc === CREATE) {
          flavorName = r.flavor;
          createFlavors.set(`${brandName}|||${r.flavor}`, { brand: brandName, flavor: r.flavor });
        } else if (fc === SKIP) {
          continue;
        } else {
          flavorName = fc;
        }
      }
      out.push({ brand: brandName, flavor: flavorName, casesPlanned: r.casesPlanned, notes: r.notes });
    }
    return {
      date: date.trim(),
      runs: mergeImportRuns(out),
      createBrands: [...createBrands],
      createFlavors: [...createFlavors.values()],
    };
  }

  const preview = buildCommit();
  const willImport = preview.runs.length;
  const skipped = rows.length - willImport;
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date.trim());

  const Chip = ({
    label,
    active,
    onPress,
    tint,
  }: {
    label: string;
    active: boolean;
    onPress: () => void;
    tint?: string;
  }) => (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          borderColor: active ? (tint ?? colors.primary) : colors.border,
          backgroundColor: active ? (tint ?? colors.primary) + "22" : "transparent",
          opacity: pressed ? 0.6 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.chipText,
          { color: active ? (tint ?? colors.primary) : colors.mutedForeground },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.foreground }]}>Import Excel</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Feather name="x" size={22} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ paddingBottom: 12 }}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>SCHEDULE DATE (YYYY-MM-DD)</Text>
            <TextInput
              value={date}
              onChangeText={setDate}
              placeholder="2026-01-01"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              style={[styles.input, { color: colors.foreground, borderColor: dateValid ? colors.border : colors.destructive }]}
            />

            {supervisorPin && !unlocked && !isManager ? (
              <View style={[styles.unlockBox, { borderColor: colors.border }]}>
                <Text style={[styles.help, { color: colors.mutedForeground }]}>
                  Enter supervisor PIN to allow creating new brands/flavors.
                </Text>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                  <TextInput
                    value={pinEntry}
                    onChangeText={setPinEntry}
                    placeholder="PIN"
                    placeholderTextColor={colors.mutedForeground}
                    secureTextEntry
                    keyboardType="number-pad"
                    style={[styles.input, { flex: 1, color: colors.foreground, borderColor: colors.border, marginTop: 0 }]}
                  />
                  <Pressable
                    onPress={() => {
                      if (pinEntry === supervisorPin) setUnlocked(true);
                    }}
                    style={({ pressed }) => [styles.unlockBtn, { borderColor: colors.primary, opacity: pressed ? 0.6 : 1 }]}
                  >
                    <Text style={{ color: colors.primary, fontWeight: "600" }}>Unlock</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {errors.length > 0 ? (
              <View style={[styles.errorBox, { borderColor: colors.destructive }]}>
                <Text style={[styles.errorTitle, { color: colors.destructive }]}>
                  {errors.length} row{errors.length === 1 ? "" : "s"} skipped
                </Text>
                {errors.slice(0, 6).map((e, i) => (
                  <Text key={i} style={[styles.help, { color: colors.mutedForeground }]}>
                    Row {e.rowNumber}: {e.message}
                  </Text>
                ))}
              </View>
            ) : null}

            {aiLoading ? (
              <View style={styles.aiLoadingRow}>
                <Feather name="zap" size={13} color={AI_TINT} />
                <Text style={[styles.aiLoadingText, { color: AI_TINT }]}>AI matching…</Text>
              </View>
            ) : null}

            {uniqueBrands.length > 0 ? (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Map Brands</Text>
                {uniqueBrands.map((cand) => {
                  const key = cand.toLowerCase();
                  const cur = brandChoice[key] ?? SKIP;
                  const sugg = chipValues(aiBrandMatch[key], fuzzyMatch(cand, brands));
                  return (
                    <View key={key} style={[styles.mapRow, { borderColor: colors.border }]}>
                      <Text style={[styles.candidate, { color: colors.foreground }]} numberOfLines={1}>
                        “{cand}”
                      </Text>
                      <View style={styles.chipRow}>
                        {sugg.map((s) => (
                          <Chip
                            key={s.value}
                            label={s.ai ? `✦ ${s.value}` : s.value}
                            active={cur === s.value}
                            tint={s.ai ? AI_TINT : undefined}
                            onPress={() => setBrandChoice((p) => ({ ...p, [key]: s.value }))}
                          />
                        ))}
                        {canCreate ? (
                          <Chip
                            label={`+ Create “${cand}”`}
                            active={cur === CREATE}
                            tint={colors.success}
                            onPress={() => setBrandChoice((p) => ({ ...p, [key]: CREATE }))}
                          />
                        ) : null}
                        <Chip
                          label="Skip"
                          active={cur === SKIP}
                          tint={colors.destructive}
                          onPress={() => setBrandChoice((p) => ({ ...p, [key]: SKIP }))}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : null}

            {uniqueFlavors.length > 0 ? (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Map Flavors</Text>
                {uniqueFlavors.map((f) => {
                  const cur = flavorChoice[f.key] ?? SKIP;
                  const sugg = chipValues(
                    aiFlavorMatch[f.key],
                    fuzzyMatch(f.flavor, brandFlavors[f.brandName] ?? []),
                  );
                  return (
                    <View key={f.key} style={[styles.mapRow, { borderColor: colors.border }]}>
                      <Text style={[styles.candidate, { color: colors.foreground }]} numberOfLines={1}>
                        {f.brandName} → “{f.flavor}”
                      </Text>
                      <View style={styles.chipRow}>
                        {sugg.map((s) => (
                          <Chip
                            key={s.value}
                            label={s.ai ? `✦ ${s.value}` : s.value}
                            active={cur === s.value}
                            tint={s.ai ? AI_TINT : undefined}
                            onPress={() => setFlavorChoice((p) => ({ ...p, [f.key]: s.value }))}
                          />
                        ))}
                        {canCreate ? (
                          <Chip
                            label={`+ Create “${f.flavor}”`}
                            active={cur === CREATE}
                            tint={colors.success}
                            onPress={() => setFlavorChoice((p) => ({ ...p, [f.key]: CREATE }))}
                          />
                        ) : null}
                        <Chip
                          label="Skip"
                          active={cur === SKIP}
                          tint={colors.destructive}
                          onPress={() => setFlavorChoice((p) => ({ ...p, [f.key]: SKIP }))}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : null}

            {uniqueBrands.length === 0 && uniqueFlavors.length === 0 ? (
              <Text style={[styles.help, { color: colors.mutedForeground, marginTop: 12 }]}>
                All brands & flavors matched existing entries.
              </Text>
            ) : null}
          </ScrollView>

          <View style={[styles.footer, { borderColor: colors.border }]}>
            <Text style={[styles.summary, { color: colors.mutedForeground }]}>
              {willImport} run{willImport === 1 ? "" : "s"} → schedule
              {skipped > 0 ? `, ${skipped} skipped` : ""}
            </Text>
            <Pressable
              disabled={willImport === 0 || !dateValid}
              onPress={() => onConfirm(buildCommit())}
              style={({ pressed }) => [
                styles.importBtn,
                {
                  backgroundColor: colors.primary,
                  opacity: willImport === 0 || !dateValid ? 0.4 : pressed ? 0.8 : 1,
                },
              ]}
            >
              <Text style={[styles.importBtnText, { color: colors.primaryForeground }]}>
                Import {willImport > 0 ? willImport : ""}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    paddingBottom: 28,
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  title: { fontSize: 18, fontWeight: "700" },
  label: { fontSize: 11, fontWeight: "600", marginBottom: 6, letterSpacing: 0.5 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    marginTop: 4,
  },
  unlockBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12, marginTop: 12 },
  unlockBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 16, justifyContent: "center" },
  errorBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12, marginTop: 12 },
  errorTitle: { fontSize: 13, fontWeight: "700", marginBottom: 4 },
  help: { fontSize: 12, lineHeight: 17 },
  aiLoadingRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 12 },
  aiLoadingText: { fontSize: 12, fontWeight: "600" },
  section: { marginTop: 16 },
  sectionTitle: { fontSize: 14, fontWeight: "700", marginBottom: 8 },
  mapRow: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 10, marginBottom: 8 },
  candidate: { fontSize: 14, fontWeight: "600", marginBottom: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { fontSize: 12, fontWeight: "600" },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
    marginTop: 8,
  },
  summary: { fontSize: 13, flex: 1 },
  importBtn: { borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12 },
  importBtnText: { fontSize: 15, fontWeight: "700" },
});
