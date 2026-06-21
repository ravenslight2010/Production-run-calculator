import React, { useEffect, useState } from "react";
import { StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Card } from "@/components/UI";
import { useColors } from "@/hooks/useColors";
import { FONTS } from "@/constants/fonts";
import { InventoryApiError } from "@/context/inventoryShared";
import {
  DEFAULT_PROACTIVE_SETTINGS,
  PROACTIVE_COOLDOWN_SECONDS_MAX,
  PROACTIVE_COOLDOWN_SECONDS_MIN,
  PROACTIVE_POLL_SECONDS_MAX,
  PROACTIVE_POLL_SECONDS_MIN,
  fetchProactiveSettings,
  updateProactiveSettings,
  type ProactiveSettings,
} from "@/context/aiProactive";

function clampMinutes(value: number, minSec: number, maxSec: number): number {
  const sec = Math.round(value * 60);
  return Math.min(maxSec, Math.max(minSec, sec));
}

// Manager-only panel: tune how aggressive the proactive shift watcher is. Turn
// it off entirely, change how often it checks for a nudge (cadence), and how
// long a dismissed nudge stays suppressed (cooldown). Server-persisted and
// factory-wide; both web and mobile hooks respect it. Inputs are in minutes for
// readability but persist as seconds. Mirrors the web ProactiveAlertSettingsCard.
export default function ProactiveAlertSettingsCard() {
  const colors = useColors();
  const [settings, setSettings] = useState<ProactiveSettings>(DEFAULT_PROACTIVE_SETTINGS);
  const [pollInput, setPollInput] = useState(String(DEFAULT_PROACTIVE_SETTINGS.pollSeconds / 60));
  const [cooldownInput, setCooldownInput] = useState(
    String(DEFAULT_PROACTIVE_SETTINGS.cooldownSeconds / 60),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await fetchProactiveSettings();
      if (cancelled) return;
      setSettings(s);
      setPollInput(String(s.pollSeconds / 60));
      setCooldownInput(String(s.cooldownSeconds / 60));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (next: ProactiveSettings) => {
    setSaving(true);
    setError(null);
    try {
      const saved = await updateProactiveSettings(next);
      setSettings(saved);
      setPollInput(String(saved.pollSeconds / 60));
      setCooldownInput(String(saved.cooldownSeconds / 60));
    } catch (e) {
      setError(
        e instanceof InventoryApiError && e.serverMessage
          ? e.serverMessage
          : "Could not save alert settings.",
      );
      setPollInput(String(settings.pollSeconds / 60));
      setCooldownInput(String(settings.cooldownSeconds / 60));
    } finally {
      setSaving(false);
    }
  };

  const onToggle = (enabled: boolean) => {
    void save({ ...settings, enabled });
  };

  const savePoll = () => {
    const minutes = Number(pollInput);
    if (!Number.isFinite(minutes)) {
      setPollInput(String(settings.pollSeconds / 60));
      return;
    }
    const pollSeconds = clampMinutes(minutes, PROACTIVE_POLL_SECONDS_MIN, PROACTIVE_POLL_SECONDS_MAX);
    if (pollSeconds === settings.pollSeconds) {
      setPollInput(String(settings.pollSeconds / 60));
      return;
    }
    void save({ ...settings, pollSeconds });
  };

  const saveCooldown = () => {
    const minutes = Number(cooldownInput);
    if (!Number.isFinite(minutes)) {
      setCooldownInput(String(settings.cooldownSeconds / 60));
      return;
    }
    const cooldownSeconds = clampMinutes(
      minutes,
      PROACTIVE_COOLDOWN_SECONDS_MIN,
      PROACTIVE_COOLDOWN_SECONDS_MAX,
    );
    if (cooldownSeconds === settings.cooldownSeconds) {
      setCooldownInput(String(settings.cooldownSeconds / 60));
      return;
    }
    void save({ ...settings, cooldownSeconds });
  };

  const disabled = loading || saving;

  return (
    <Card title="Proactive Alerts" icon="bell" style={{ marginBottom: 16 }}>
      <View style={{ gap: 12 }}>
        <View style={styles.row}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            Show proactive shift alerts
          </Text>
          <Switch value={settings.enabled} onValueChange={onToggle} disabled={disabled} />
        </View>

        <View style={[{ gap: 12 }, !settings.enabled && { opacity: 0.5 }]}>
          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>
              Check every (minutes)
            </Text>
            <TextInput
              style={[
                styles.input,
                { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background },
              ]}
              value={pollInput}
              onChangeText={setPollInput}
              onBlur={savePoll}
              editable={!disabled && settings.enabled}
              keyboardType="decimal-pad"
              placeholderTextColor={colors.mutedForeground}
            />
          </View>
          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>
              Snooze dismissed alert (minutes)
            </Text>
            <TextInput
              style={[
                styles.input,
                { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background },
              ]}
              value={cooldownInput}
              onChangeText={setCooldownInput}
              onBlur={saveCooldown}
              editable={!disabled && settings.enabled}
              keyboardType="number-pad"
              placeholderTextColor={colors.mutedForeground}
            />
          </View>
        </View>

        {error ? <Text style={[styles.msg, { color: colors.destructive }]}>{error}</Text> : null}
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          Controls how often the assistant checks for a timely nudge while a day is running, and how
          long a dismissed nudge stays hidden. Turn off to silence proactive alerts entirely.
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  label: { fontSize: 13, fontFamily: FONTS.medium, flexShrink: 1 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: FONTS.regular,
    width: 80,
    textAlign: "right",
  },
  msg: { fontSize: 12, fontFamily: FONTS.regular },
  hint: { fontSize: 12, fontFamily: FONTS.regular, lineHeight: 17 },
});
