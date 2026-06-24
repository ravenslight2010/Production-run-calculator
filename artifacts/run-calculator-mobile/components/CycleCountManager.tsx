// Manager-only editor for factory-wide cycle-count schedules (mobile parity with
// the web CycleCountManager). Each schedule names a warehouse section that must
// be counted every `cadenceDays` days (default 7). Schedules are persisted
// server-side and drive the "Time to Count" card on the Warehouse tab. The
// server enforces the manager role on writes; this card is only rendered for
// managers.
//
// `suggestions` are common/known section names so a manager can add one in a
// single tap instead of retyping it.

import { Feather } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import React from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import {
  DEFAULT_CADENCE_DAYS,
  type CycleCountSchedule,
} from "@workspace/cycle-count";
import { FONTS } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import { useCycleCountSchedules } from "@/hooks/useCycleCountSchedules";
import {
  deleteCycleCountSchedules,
  saveCycleCountSchedules,
} from "@/context/cycleCount";

function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function CycleCountManager({
  suggestions = [],
}: {
  suggestions?: string[];
}) {
  const colors = useColors();
  const qc = useQueryClient();
  const { schedules, isLoading } = useCycleCountSchedules();
  const [error, setError] = React.useState<string | null>(null);
  const [newName, setNewName] = React.useState("");

  const scheduled = React.useMemo(
    () => new Set(schedules.map((s) => s.section.trim().toLowerCase())),
    [schedules],
  );
  const quickAdd = React.useMemo(
    () =>
      Array.from(new Set(suggestions.map((s) => s.trim()).filter(Boolean)))
        .filter((s) => !scheduled.has(s.toLowerCase()))
        .sort((a, b) => a.localeCompare(b)),
    [suggestions, scheduled],
  );

  const saveMutation = useMutation({
    mutationFn: (next: CycleCountSchedule[]) => saveCycleCountSchedules(next),
    onSuccess: (saved) => {
      qc.setQueryData(["cycleCountSchedules"], saved);
      setError(null);
    },
    onError: () =>
      setError("Could not save the schedule. Check your connection and try again."),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => deleteCycleCountSchedules(ids),
    onSuccess: (saved) => {
      qc.setQueryData(["cycleCountSchedules"], saved);
      setError(null);
    },
    onError: () =>
      setError("Could not delete the schedule. Check your connection and try again."),
  });

  const busy = saveMutation.isPending || deleteMutation.isPending;

  function addSchedule(section: string) {
    const name = section.trim();
    if (!name) return;
    if (scheduled.has(name.toLowerCase())) {
      setNewName("");
      return;
    }
    saveMutation.mutate([
      {
        id: genId(),
        section: name,
        cadenceDays: DEFAULT_CADENCE_DAYS,
        lastCountedAt: null,
        enabled: true,
      },
    ]);
    setNewName("");
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={{ fontFamily: FONTS.regular, fontSize: 12, color: colors.mutedForeground }}>
        Schedule warehouse sections for regular inventory counts. Each section is
        counted every N days (default {DEFAULT_CADENCE_DAYS}). The Warehouse tab
        shows a "Time to Count" card once a section is due.
      </Text>

      {error ? (
        <View
          style={{
            flexDirection: "row",
            gap: 8,
            padding: 10,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: "#dc2626",
            backgroundColor: "#dc262622",
          }}
        >
          <Feather name="alert-triangle" size={14} color="#fca5a5" style={{ marginTop: 2 }} />
          <Text style={{ flex: 1, fontFamily: FONTS.regular, fontSize: 12, color: "#fca5a5" }}>
            {error}
          </Text>
        </View>
      ) : null}

      {isLoading ? (
        <Text style={{ fontFamily: FONTS.regular, fontSize: 12, color: colors.mutedForeground }}>
          Loading schedules…
        </Text>
      ) : schedules.length === 0 ? (
        <Text style={{ fontFamily: FONTS.regular, fontSize: 12, color: colors.mutedForeground }}>
          No cycle-count schedules yet. Add one below.
        </Text>
      ) : (
        <View style={{ gap: 10 }}>
          {schedules.map((schedule) => (
            <ScheduleEditor
              key={schedule.id}
              schedule={schedule}
              disabled={busy}
              onChange={(next) => saveMutation.mutate([next])}
              onDelete={() => deleteMutation.mutate([schedule.id])}
            />
          ))}
        </View>
      )}

      {/* Add by typing */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 4 }}>
        <TextInput
          value={newName}
          onChangeText={setNewName}
          onSubmitEditing={() => addSchedule(newName)}
          placeholder="Section name…"
          placeholderTextColor={colors.mutedForeground}
          editable={!busy}
          style={{
            flex: 1,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.background,
            color: colors.foreground,
            paddingHorizontal: 10,
            paddingVertical: 8,
            fontFamily: FONTS.regular,
            fontSize: 13,
          }}
        />
        <Pressable
          onPress={() => addSchedule(newName)}
          disabled={busy || !newName.trim()}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderRadius: 8,
            backgroundColor: colors.primary,
            opacity: busy || !newName.trim() ? 0.5 : 1,
          }}
        >
          <Feather name="plus" size={14} color={colors.primaryForeground} />
          <Text style={{ fontFamily: FONTS.bold, fontSize: 13, color: colors.primaryForeground }}>
            Add
          </Text>
        </Pressable>
      </View>

      {/* One-tap add from common section names */}
      {quickAdd.length > 0 ? (
        <View style={{ gap: 6 }}>
          <Text style={{ fontFamily: FONTS.medium, fontSize: 11, color: colors.mutedForeground }}>
            Add from existing sections
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {quickAdd.slice(0, 30).map((s) => (
              <Pressable
                key={s}
                onPress={() => addSchedule(s)}
                disabled={busy}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.secondary,
                  opacity: busy ? 0.5 : 1,
                }}
              >
                <Feather name="plus" size={11} color={colors.mutedForeground} />
                <Text style={{ fontFamily: FONTS.regular, fontSize: 11, color: colors.mutedForeground }}>
                  {s}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function ScheduleEditor({
  schedule,
  disabled,
  onChange,
  onDelete,
}: {
  schedule: CycleCountSchedule;
  disabled: boolean;
  onChange: (schedule: CycleCountSchedule) => void;
  onDelete: () => void;
}) {
  const colors = useColors();
  const patch = (p: Partial<CycleCountSchedule>) => onChange({ ...schedule, ...p });

  return (
    <View
      style={{
        gap: 10,
        padding: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.secondary,
      }}
    >
      <TextInput
        value={schedule.section}
        onChangeText={(t) => patch({ section: t })}
        editable={!disabled}
        style={{
          borderRadius: 8,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.background,
          color: colors.foreground,
          paddingHorizontal: 10,
          paddingVertical: 8,
          fontFamily: FONTS.medium,
          fontSize: 13,
        }}
      />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ fontFamily: FONTS.regular, fontSize: 12, color: colors.mutedForeground }}>
            every
          </Text>
          <TextInput
            value={String(schedule.cadenceDays)}
            onChangeText={(t) =>
              patch({ cadenceDays: Math.max(1, Math.trunc(Number(t) || 1)) })
            }
            keyboardType="number-pad"
            editable={!disabled}
            style={{
              width: 56,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.background,
              color: colors.foreground,
              paddingHorizontal: 8,
              paddingVertical: 6,
              fontFamily: FONTS.mono,
              fontSize: 13,
              textAlign: "center",
            }}
          />
          <Text style={{ fontFamily: FONTS.regular, fontSize: 12, color: colors.mutedForeground }}>
            days
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Switch
            value={schedule.enabled}
            onValueChange={(v) => patch({ enabled: v })}
            disabled={disabled}
          />
          <Pressable onPress={onDelete} disabled={disabled} hitSlop={8}>
            <Feather name="trash-2" size={16} color="#f87171" />
          </Pressable>
        </View>
      </View>
      <Text style={{ fontFamily: FONTS.regular, fontSize: 11, color: colors.mutedForeground }}>
        {schedule.lastCountedAt
          ? `Last counted ${schedule.lastCountedAt}`
          : "Never counted"}
      </Text>
    </View>
  );
}
