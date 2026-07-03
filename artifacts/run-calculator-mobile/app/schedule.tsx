import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as Haptics from "expo-haptics";
import { Stack, useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as XLSX from "xlsx";
import ExcelImportModal, { type ImportCommit } from "@/components/ExcelImportModal";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { showNote } from "@/utils/notify";
import { CardSection, SectionHeader } from "@/components/UI";
import { profileKey, todayStr, useRun } from "@/context/RunContext";
import { useColors } from "@/hooks/useColors";
import { FONTS } from "@/constants/fonts";
import {
  parseRunWorkbookBase64,
  parseWorkbookObject,
  filterImportFromDate,
  skipAlreadyRanRuns,
  type ImportParseResult,
} from "@/utils/runExcel";
import {
  buildCaseUpdateOffers,
  promptCaseUpdates,
  type CaseUpdateOffer,
} from "@/utils/importCaseUpdates";

function tap() {
  Haptics.selectionAsync();
}

function nextDates(count: number): string[] {
  const out: string[] = [];
  const base = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    out.push(
      `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d
        .getDate()
        .toString()
        .padStart(2, "0")}`,
    );
  }
  return out;
}

function fmtDayShort(s: string): { weekday: string; day: string } {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return {
    weekday: dt.toLocaleDateString(undefined, { weekday: "short" }),
    day: dt.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  };
}

export default function ScheduleScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    brands,
    brandFlavors,
    brandProfiles,
    scheduled,
    allRuns,
    addScheduledRun,
    importScheduledRuns,
    addFlavor,
    addListItem,
    removeScheduledRun,
    clearScheduledDay,
    moveScheduledDay,
    moveScheduledRun,
    applyScheduledDay,
    supervisorPin,
    updateRunSettingsById,
  } = useRun();

  const today = todayStr();
  const dates = useMemo(() => nextDates(14), []);
  const [selectedDate, setSelectedDate] = useState(today);

  const [brand, setBrand] = useState("");
  const [flavor, setFlavor] = useState("");
  const [cases, setCases] = useState("");
  const [dieType, setDieType] = useState("");
  const [notes, setNotes] = useState("");

  const dayRuns = scheduled[selectedDate] ?? [];
  const flavorOptions = brand ? brandFlavors[brand] ?? [] : [];

  // Move a single run (runId set) or the whole day (runId null) to another date.
  // Mobile's schedule pool is today + future (the live `runs` list is never touched).
  const [moveTarget, setMoveTarget] = useState<{ runId: string | null } | null>(null);
  const doMove = (toDate: string) => {
    if (!moveTarget || toDate === selectedDate) return;
    if (moveTarget.runId === null) moveScheduledDay(selectedDate, toDate);
    else moveScheduledRun(selectedDate, moveTarget.runId, toDate);
    setMoveTarget(null);
    setSelectedDate(toDate);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const canAdd = brand.trim().length > 0 && flavor.trim().length > 0;

  const add = () => {
    if (!canAdd) return;
    addScheduledRun(selectedDate, {
      brand: brand.trim(),
      flavor: flavor.trim(),
      casesNeeded: Math.max(0, parseInt(cases, 10) || 0),
      dieType: dieType.trim(),
      notes: notes.trim(),
    });
    setFlavor("");
    setCases("");
    setNotes("");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const apply = () => {
    if (dayRuns.length === 0) return;
    if (applyScheduledDay(selectedDate)) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    }
  };

  const [importResult, setImportResult] = useState<ImportParseResult | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  async function handleImportPick() {
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
      // Multi-sheet schedule planner: keep only runs dated today-or-later (the
      // user's chosen behavior) and route to the multi-date override commit.
      const result = parsed.multiDay ? filterImportFromDate(parsed, today) : parsed;
      setImportResult(result);
      setImportOpen(true);
    } catch {
      // ignore — user can retry
    }
  }

  function commitImport(payload: ImportCommit) {
    payload.createBrands.forEach((b) => addListItem("brands", b));
    payload.createFlavors.forEach((cf) => addFlavor(cf.brand, cf.flavor));
    if (payload.multiDay) {
      // Multi-sheet planner: write every date in one override update (drop prior
      // imported runs per date, keep manual runs, tag the new ones imported).
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
      let skipped = 0;
      const caseUpdateOffers: CaseUpdateOffer[] = [];
      const effective = byDate.map((day) => {
        if (day.date !== today) return day;
        const res = skipAlreadyRanRuns(day.runs, alreadyRan);
        skipped += res.skipped;
        // A skipped row may list a NEW case count for a run already going —
        // collect an offer (never auto-applied; finished runs untouched).
        caseUpdateOffers.push(...buildCaseUpdateOffers(res.matches));
        return { ...day, runs: res.rows };
      });
      importScheduledRuns(effective);
      const skippedNote =
        skipped > 0 ? `${skipped} run${skipped === 1 ? "" : "s"} already ran today, skipped.\n\n` : "";
      if (caseUpdateOffers.length > 0) {
        promptCaseUpdates(caseUpdateOffers, skippedNote, (o) =>
          updateRunSettingsById(o.runId, { casesNeeded: o.to }),
        );
      } else if (skipped > 0) {
        showNote(
          "Some runs skipped",
          `${skipped} run${skipped === 1 ? "" : "s"} already ran today, skipped.`,
        );
      }
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

  const webTop = Platform.OS === "web" ? 16 : 0;
  const webBottom = Platform.OS === "web" ? 34 : 0;

  return (
    <>
      <Stack.Screen options={{ title: "Production Schedule", headerShown: true }} />
      <KeyboardAwareScrollViewCompat
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{
          padding: 16,
          paddingTop: webTop + 8,
          paddingBottom: insets.bottom + webBottom + 48,
          gap: 4,
        }}
      >
        <SectionHeader title="Pick a Day" />
        <View style={styles.dateRow}>
          {dates.map((d) => {
            const sel = d === selectedDate;
            const { weekday, day } = fmtDayShort(d);
            const count = (scheduled[d] ?? []).length;
            return (
              <Pressable
                key={d}
                onPress={() => {
                  setSelectedDate(d);
                  tap();
                }}
                style={[
                  styles.dateChip,
                  {
                    backgroundColor: sel ? colors.primary : colors.card,
                    borderColor: sel ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.dateWeekday,
                    { color: sel ? colors.primaryForeground : colors.mutedForeground },
                  ]}
                >
                  {d === today ? "Today" : weekday}
                </Text>
                <Text
                  style={[
                    styles.dateDay,
                    { color: sel ? colors.primaryForeground : colors.foreground },
                  ]}
                >
                  {day}
                </Text>
                {count > 0 ? (
                  <View
                    style={[
                      styles.dateBadge,
                      {
                        backgroundColor: sel
                          ? colors.primaryForeground
                          : colors.primary,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.dateBadgeText,
                        { color: sel ? colors.primary : colors.primaryForeground },
                      ]}
                    >
                      {count}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        <SectionHeader title="Planned Runs" />
        <CardSection>
          {dayRuns.length === 0 ? (
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              No runs planned for this day yet — add one below.
            </Text>
          ) : (
            dayRuns.map((r) => (
              <View
                key={r.id}
                style={[styles.planRow, { borderColor: colors.border }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.planTitle, { color: colors.foreground }]}>
                    {r.brand} · {r.flavor}
                  </Text>
                  <Text style={[styles.planMeta, { color: colors.mutedForeground }]}>
                    {r.casesNeeded > 0 ? `${r.casesNeeded} cases` : "No case target"}
                    {r.dieType ? ` · ${r.dieType}` : ""}
                  </Text>
                  {r.notes ? (
                    <Text
                      style={[styles.planNotes, { color: colors.mutedForeground }]}
                    >
                      {r.notes}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => {
                    setMoveTarget({ runId: r.id });
                    tap();
                  }}
                  hitSlop={8}
                  style={styles.planDelBtn}
                >
                  <Feather name="corner-up-right" size={16} color={colors.mutedForeground} />
                </Pressable>
                <Pressable
                  onPress={() => {
                    removeScheduledRun(selectedDate, r.id);
                    tap();
                  }}
                  hitSlop={8}
                  style={styles.planDelBtn}
                >
                  <Feather name="trash-2" size={16} color={colors.mutedForeground} />
                </Pressable>
              </View>
            ))
          )}
        </CardSection>

        {moveTarget ? (
          <CardSection>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
              {moveTarget.runId === null
                ? "Move all runs to…"
                : "Move this run to…"}
            </Text>
            <View style={[styles.optionWrap, { marginTop: 8 }]}>
              {dates
                .filter((d) => d !== selectedDate)
                .map((d) => {
                  const { weekday, day } = fmtDayShort(d);
                  return (
                    <Pressable
                      key={d}
                      onPress={() => doMove(d)}
                      style={[
                        styles.optionChip,
                        { borderColor: colors.border, backgroundColor: colors.secondary },
                      ]}
                    >
                      <Text style={[styles.optionText, { color: colors.foreground }]}>
                        {d === today ? "Today" : `${weekday} ${day}`}
                      </Text>
                    </Pressable>
                  );
                })}
            </View>
            <Pressable
              onPress={() => {
                setMoveTarget(null);
                tap();
              }}
              style={({ pressed }) => [
                styles.clearBtn,
                {
                  borderColor: colors.border,
                  opacity: pressed ? 0.6 : 1,
                  alignSelf: "flex-start",
                  marginTop: 10,
                },
              ]}
            >
              <Feather name="x" size={15} color={colors.foreground} />
            </Pressable>
          </CardSection>
        ) : null}

        {dayRuns.length > 0 ? (
          <View style={styles.actionRow}>
            <Pressable
              onPress={apply}
              style={({ pressed }) => [
                styles.applyBtn,
                { backgroundColor: colors.primary, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Feather name="play" size={15} color={colors.primaryForeground} />
              <Text style={[styles.applyText, { color: colors.primaryForeground }]}>
                Load into today&apos;s runs
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setMoveTarget({ runId: null });
                tap();
              }}
              style={({ pressed }) => [
                styles.clearBtn,
                { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Feather name="corner-up-right" size={15} color={colors.foreground} />
            </Pressable>
            <Pressable
              onPress={() => {
                clearScheduledDay(selectedDate);
                tap();
              }}
              style={({ pressed }) => [
                styles.clearBtn,
                { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Feather name="x" size={15} color={colors.foreground} />
            </Pressable>
          </View>
        ) : null}

        <Pressable
          onPress={() => {
            handleImportPick();
            tap();
          }}
          style={({ pressed }) => [
            styles.importBtn,
            { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Feather name="upload" size={15} color={colors.primary} />
          <Text style={[styles.importText, { color: colors.primary }]}>
            Import schedule from Excel
          </Text>
        </Pressable>

        <SectionHeader title="Add a Planned Run" />
        <CardSection>
          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
            Brand
          </Text>
          <View style={styles.optionWrap}>
            {brands.map((b) => (
              <Pressable
                key={b}
                onPress={() => {
                  setBrand(b);
                  setFlavor("");
                  tap();
                }}
                style={[
                  styles.optionChip,
                  {
                    borderColor: brand === b ? colors.primary : colors.border,
                    backgroundColor:
                      brand === b ? colors.primary + "22" : colors.secondary,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.optionText,
                    { color: brand === b ? colors.primary : colors.foreground },
                  ]}
                >
                  {b}
                </Text>
              </Pressable>
            ))}
          </View>

          {brand ? (
            <>
              <Text
                style={[
                  styles.fieldLabel,
                  { color: colors.mutedForeground, marginTop: 12 },
                ]}
              >
                Flavor
              </Text>
              {flavorOptions.length > 0 ? (
                <View style={styles.optionWrap}>
                  {flavorOptions.map((f) => (
                    <Pressable
                      key={f}
                      onPress={() => {
                        setFlavor(f);
                        tap();
                      }}
                      style={[
                        styles.optionChip,
                        {
                          borderColor: flavor === f ? colors.primary : colors.border,
                          backgroundColor:
                            flavor === f ? colors.primary + "22" : colors.secondary,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.optionText,
                          { color: flavor === f ? colors.primary : colors.foreground },
                        ]}
                      >
                        {f}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <Text style={[styles.empty, { color: colors.mutedForeground }]}>
                  No saved flavors — type one below.
                </Text>
              )}
              <TextInput
                style={[
                  styles.input,
                  { color: colors.foreground, borderColor: colors.border, marginTop: 8 },
                ]}
                value={flavor}
                onChangeText={setFlavor}
                placeholder="Flavor"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="words"
              />
            </>
          ) : null}

          <View style={styles.inlineRow}>
            <TextInput
              style={[
                styles.input,
                { flex: 1, color: colors.foreground, borderColor: colors.border },
              ]}
              value={cases}
              onChangeText={setCases}
              placeholder="Cases needed"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="number-pad"
            />
            <TextInput
              style={[
                styles.input,
                { flex: 1, color: colors.foreground, borderColor: colors.border },
              ]}
              value={dieType}
              onChangeText={setDieType}
              placeholder="Die type (optional)"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="words"
            />
          </View>
          <TextInput
            style={[
              styles.input,
              { color: colors.foreground, borderColor: colors.border, marginTop: 8 },
            ]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Notes (optional)"
            placeholderTextColor={colors.mutedForeground}
          />

          <Pressable
            onPress={add}
            disabled={!canAdd}
            style={({ pressed }) => [
              styles.addBtn,
              {
                backgroundColor: colors.primary,
                opacity: !canAdd ? 0.4 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Feather name="plus" size={16} color={colors.primaryForeground} />
            <Text style={[styles.addText, { color: colors.primaryForeground }]}>
              Add to {selectedDate === today ? "today" : fmtDayShort(selectedDate).day}
            </Text>
          </Pressable>
        </CardSection>
      </KeyboardAwareScrollViewCompat>

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
        defaultDate={selectedDate}
        onConfirm={commitImport}
      />
    </>
  );
}

const styles = StyleSheet.create({
  dateRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  dateChip: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: "center",
    minWidth: 64,
  },
  dateWeekday: {
    fontSize: 10,
    fontFamily: FONTS.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  dateDay: { fontSize: 13, fontFamily: FONTS.bold, marginTop: 2 },
  dateBadge: {
    marginTop: 4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  dateBadgeText: { fontSize: 10, fontFamily: FONTS.bold },

  empty: { fontSize: 13, fontStyle: "italic" },
  planRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  planTitle: { fontSize: 14, fontFamily: FONTS.bold },
  planMeta: { fontSize: 12, marginTop: 2 },
  planNotes: { fontSize: 12, marginTop: 2, fontStyle: "italic" },
  planDelBtn: { padding: 6 },

  actionRow: { flexDirection: "row", gap: 8, marginTop: 10, marginBottom: 4 },
  applyBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 10,
    paddingVertical: 12,
  },
  applyText: { fontSize: 14, fontFamily: FONTS.bold },
  clearBtn: {
    width: 46,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },

  fieldLabel: { fontSize: 12, fontFamily: FONTS.semibold },
  optionWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  optionChip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  optionText: { fontSize: 13, fontFamily: FONTS.medium },
  inlineRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    fontFamily: FONTS.regular,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 14,
  },
  addText: { fontSize: 14, fontFamily: FONTS.bold },
  importBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 11,
    marginTop: 6,
  },
  importText: { fontSize: 14, fontFamily: FONTS.semibold },
});
