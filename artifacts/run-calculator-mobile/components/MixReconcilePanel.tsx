// Mix monitoring cross-reference panel (mobile).
//
// Lists the saved premix sheets AND the saved spec sheets, and lets the user
// cross-reference the CURRENT mixes against either one. The deterministic diff
// (which products need a NEW mix, which existing mixes have DRIFTED) runs
// client-side via @workspace/mix-reconcile; an advisory AI summary narrates it.
// Each drifted/new item offers a one-tap "Apply suggested fix" that writes
// through the manager-gated saveMixes path (only shown to managers). Mirrors the
// web component in artifacts/run-calculator/src/components/MixReconcilePanel.tsx
// (replit.md parity).

import React from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import type { MixReconcileItem } from "@workspace/mix-reconcile";
import { FONTS } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import {
  fetchSavedPremixSheets,
  deletePremixSheet,
  type SavedPremixSheet,
} from "@/context/savedPremixSheets";
import {
  fetchSavedSpecSheets,
  type SavedSpecSheet,
} from "@/context/savedSpecSheets";
import {
  reconcilePremixSheet,
  reconcileSpecSheetMixes,
  applyMixReconcileItem,
  type MixReconcileView,
} from "@/context/mixReconcile";

function fmtDate(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function MixReconcilePanel({ isManager }: { isManager: boolean }) {
  const colors = useColors();
  const qc = useQueryClient();
  const [premixSheets, setPremixSheets] = React.useState<SavedPremixSheet[]>([]);
  const [specSheets, setSpecSheets] = React.useState<SavedSpecSheet[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [listError, setListError] = React.useState<string | null>(null);

  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<MixReconcileView | null>(null);
  const [resultError, setResultError] = React.useState<string | null>(null);
  const [appliedIds, setAppliedIds] = React.useState<Set<string>>(new Set());

  async function refresh() {
    setLoading(true);
    setListError(null);
    try {
      const [premix, spec] = await Promise.all([
        fetchSavedPremixSheets(),
        fetchSavedSpecSheets(),
      ]);
      setPremixSheets(premix);
      setSpecSheets(spec);
    } catch {
      setListError("Couldn't load saved sheets.");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void refresh();
  }, []);

  async function handleCheckPremix(s: SavedPremixSheet) {
    setBusyKey(`premix-${s.id}`);
    setResult(null);
    setResultError(null);
    setAppliedIds(new Set());
    try {
      setResult(await reconcilePremixSheet(s.id, s.label));
    } catch {
      setResultError("Couldn't check that premix sheet. Please try again.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleCheckSpec(s: SavedSpecSheet) {
    setBusyKey(`spec-${s.id}`);
    setResult(null);
    setResultError(null);
    setAppliedIds(new Set());
    try {
      setResult(await reconcileSpecSheetMixes(s.id, s.label));
    } catch {
      setResultError("Couldn't check that spec sheet. Please try again.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleDeletePremix(id: number) {
    setBusyKey(`premix-${id}`);
    try {
      const next = await deletePremixSheet(id);
      setPremixSheets(next);
      if (result?.source === "premix") setResult(null);
    } catch {
      setResultError("Couldn't delete that premix sheet.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleApply(item: MixReconcileItem) {
    setBusyKey(`apply-${item.mixId}`);
    try {
      await applyMixReconcileItem(item);
      await qc.invalidateQueries({ queryKey: ["mixes"] });
      setAppliedIds((prev) => new Set(prev).add(item.mixId));
    } catch {
      setResultError("Couldn't apply that fix. Please try again.");
    } finally {
      setBusyKey(null);
    }
  }

  const muted = { fontFamily: FONTS.regular, fontSize: 12, color: colors.mutedForeground } as const;

  function SheetRow({
    label,
    createdAt,
    checking,
    onCheck,
    onDelete,
  }: {
    label: string;
    createdAt: number;
    checking: boolean;
    onCheck: () => void;
    onDelete?: () => void;
  }) {
    return (
      <View
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
          {label}
        </Text>
        <Text style={{ fontSize: 12, color: colors.mutedForeground }}>
          Imported {fmtDate(createdAt)}
        </Text>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Pressable
            onPress={onCheck}
            disabled={busyKey !== null}
            style={({ pressed }) => ({
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderRadius: 8,
              backgroundColor: colors.primary,
              opacity: busyKey !== null || pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ fontFamily: FONTS.bold, fontSize: 13, color: colors.primaryForeground }}>
              {checking ? "Checking…" : "Check mixes"}
            </Text>
          </Pressable>
          {onDelete ? (
            <Pressable
              onPress={onDelete}
              disabled={busyKey !== null}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderRadius: 8,
                backgroundColor: colors.secondary,
                borderWidth: 1,
                borderColor: colors.border,
                opacity: busyKey !== null || pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ fontFamily: FONTS.bold, fontSize: 13, color: colors.foreground }}>
                Delete
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={muted}>
        Cross-reference your current mixes against an imported premix sheet or
        spec sheet to spot products that need a new mix and existing mixes whose
        ingredients or amounts have drifted.
      </Text>

      {loading ? (
        <ActivityIndicator color={colors.primary} />
      ) : listError ? (
        <Text style={{ fontSize: 13, color: colors.destructive }}>{listError}</Text>
      ) : (
        <View style={{ gap: 12 }}>
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 13, fontFamily: FONTS.medium, color: colors.foreground }}>
              Premix sheets
            </Text>
            {premixSheets.length === 0 ? (
              <Text style={muted}>
                No saved premix sheets yet. Import a premix workbook and it will appear here.
              </Text>
            ) : (
              premixSheets.map((s) => (
                <SheetRow
                  key={s.id}
                  label={s.label}
                  createdAt={s.createdAt}
                  checking={busyKey === `premix-${s.id}`}
                  onCheck={() => handleCheckPremix(s)}
                  onDelete={() => handleDeletePremix(s.id)}
                />
              ))
            )}
          </View>

          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 13, fontFamily: FONTS.medium, color: colors.foreground }}>
              Spec sheets
            </Text>
            {specSheets.length === 0 ? (
              <Text style={muted}>
                No saved spec sheets yet. Import a spec sheet and it will appear here.
              </Text>
            ) : (
              specSheets.map((s) => (
                <SheetRow
                  key={s.id}
                  label={s.label}
                  createdAt={s.createdAt}
                  checking={busyKey === `spec-${s.id}`}
                  onCheck={() => handleCheckSpec(s)}
                />
              ))
            )}
          </View>
        </View>
      )}

      {resultError ? (
        <Text style={{ fontSize: 13, color: colors.destructive }}>{resultError}</Text>
      ) : null}

      {result ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 8,
            padding: 12,
            gap: 10,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Text style={{ fontSize: 14, fontFamily: FONTS.bold, color: colors.foreground }}>
              {result.label}
            </Text>
            <Text style={{ fontSize: 12, color: colors.mutedForeground }}>
              {result.items.length === 0
                ? "All mixes match"
                : `${result.items.length} mix${
                    result.items.length === 1 ? "" : "es"
                  } to review`}
            </Text>
          </View>

          {result.summary ? (
            <Text style={{ fontSize: 13, color: colors.foreground }}>{result.summary}</Text>
          ) : null}

          {result.items.length === 0 ? (
            <Text style={muted}>Every current mix matches this sheet.</Text>
          ) : (
            result.items.map((item) => {
              const applied = appliedIds.has(item.mixId);
              return (
                <View
                  key={`${item.source}-${item.mixId}`}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 8,
                    padding: 10,
                    gap: 8,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
                      <Text
                        style={{
                          fontSize: 11,
                          fontFamily: FONTS.bold,
                          color: item.status === "new" ? colors.primary : colors.mutedForeground,
                        }}
                      >
                        {item.status === "new" ? "NEW MIX" : "DRIFTED"}
                      </Text>
                      <Text
                        style={{ fontSize: 13, fontFamily: FONTS.medium, color: colors.foreground }}
                      >
                        {item.mixName}
                      </Text>
                      <Text style={{ fontSize: 11, color: colors.mutedForeground }}>
                        {[item.brand, item.flavor].filter(Boolean).join(" ")}
                      </Text>
                    </View>
                    {isManager ? (
                      applied ? (
                        <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Applied</Text>
                      ) : (
                        <Pressable
                          onPress={() => handleApply(item)}
                          disabled={busyKey !== null}
                          style={({ pressed }) => ({
                            paddingHorizontal: 12,
                            paddingVertical: 8,
                            borderRadius: 8,
                            backgroundColor: colors.primary,
                            opacity: busyKey !== null || pressed ? 0.7 : 1,
                          })}
                        >
                          <Text
                            style={{
                              fontFamily: FONTS.bold,
                              fontSize: 12,
                              color: colors.primaryForeground,
                            }}
                          >
                            {busyKey === `apply-${item.mixId}`
                              ? "Applying…"
                              : item.status === "new"
                                ? "Create this mix"
                                : "Apply suggested fix"}
                          </Text>
                        </Pressable>
                      )
                    ) : null}
                  </View>
                  <View style={{ gap: 4 }}>
                    {item.discrepancies.map((d, i) => (
                      <Text key={i} style={{ fontSize: 13, color: colors.mutedForeground }}>
                        {d.message}
                      </Text>
                    ))}
                  </View>
                </View>
              );
            })
          )}
        </View>
      ) : null}
    </View>
  );
}
