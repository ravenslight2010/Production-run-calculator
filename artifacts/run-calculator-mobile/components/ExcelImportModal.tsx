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
  type ImportParseResult,
} from "@/utils/runExcel";

const SKIP = "";
const CREATE = "__create__";

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
      runs: out,
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

            {uniqueBrands.length > 0 ? (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Map Brands</Text>
                {uniqueBrands.map((cand) => {
                  const key = cand.toLowerCase();
                  const cur = brandChoice[key] ?? SKIP;
                  const sugg = fuzzyMatch(cand, brands);
                  return (
                    <View key={key} style={[styles.mapRow, { borderColor: colors.border }]}>
                      <Text style={[styles.candidate, { color: colors.foreground }]} numberOfLines={1}>
                        “{cand}”
                      </Text>
                      <View style={styles.chipRow}>
                        {sugg.map((s) => (
                          <Chip
                            key={s.value}
                            label={s.value}
                            active={cur === s.value}
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
                  const sugg = fuzzyMatch(f.flavor, brandFlavors[f.brandName] ?? []);
                  return (
                    <View key={f.key} style={[styles.mapRow, { borderColor: colors.border }]}>
                      <Text style={[styles.candidate, { color: colors.foreground }]} numberOfLines={1}>
                        {f.brandName} → “{f.flavor}”
                      </Text>
                      <View style={styles.chipRow}>
                        {sugg.map((s) => (
                          <Chip
                            key={s.value}
                            label={s.value}
                            active={cur === s.value}
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
