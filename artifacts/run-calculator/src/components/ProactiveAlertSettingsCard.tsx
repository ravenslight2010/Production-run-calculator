import { useEffect, useState } from "react";
import { BellRing, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_PROACTIVE_SETTINGS,
  PROACTIVE_COOLDOWN_SECONDS_MAX,
  PROACTIVE_COOLDOWN_SECONDS_MIN,
  PROACTIVE_POLL_SECONDS_MAX,
  PROACTIVE_POLL_SECONDS_MIN,
  fetchProactiveSettings,
  updateProactiveSettings,
  type ProactiveSettings,
} from "../aiProactive";
import { InventoryApiError } from "../inventoryShared";

function clampMinutes(value: number, minSec: number, maxSec: number): number {
  const sec = Math.round(value * 60);
  return Math.min(maxSec, Math.max(minSec, sec));
}

// Manager-only panel: tune how aggressive the proactive shift watcher is. Turn
// it off entirely, change how often it checks for a nudge (cadence), and how
// long a dismissed nudge stays suppressed (cooldown). Server-persisted and
// factory-wide; both web and mobile hooks respect it. Inputs are in minutes for
// readability but persist as seconds.
export default function ProactiveAlertSettingsCard() {
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

  async function save(next: ProactiveSettings) {
    setSaving(true);
    setError(null);
    try {
      const saved = await updateProactiveSettings(next);
      setSettings(saved);
      setPollInput(String(saved.pollSeconds / 60));
      setCooldownInput(String(saved.cooldownSeconds / 60));
    } catch (e) {
      const msg =
        e instanceof InventoryApiError && e.serverMessage
          ? e.serverMessage
          : "Could not save alert settings.";
      setError(msg);
      // Revert the visible inputs to the last known-good values.
      setPollInput(String(settings.pollSeconds / 60));
      setCooldownInput(String(settings.cooldownSeconds / 60));
    } finally {
      setSaving(false);
    }
  }

  function onToggle(enabled: boolean) {
    void save({ ...settings, enabled });
  }

  function savePoll() {
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
  }

  function saveCooldown() {
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
  }

  return (
    <Card className="bg-card/50 border-border/50 shadow-md">
      <CardHeader className="pb-2 pt-4 px-5">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <BellRing className="w-4 h-4" /> Proactive Alerts
          {(loading || saving) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="proactive-enabled" className="text-sm text-muted-foreground">
            Show proactive shift alerts
          </Label>
          <Switch
            id="proactive-enabled"
            checked={settings.enabled}
            disabled={loading || saving}
            onCheckedChange={onToggle}
          />
        </div>

        <div className={settings.enabled ? "space-y-3" : "space-y-3 opacity-50"}>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="proactive-poll" className="text-sm text-muted-foreground">
              Check every (minutes)
            </Label>
            <Input
              id="proactive-poll"
              type="number"
              min={PROACTIVE_POLL_SECONDS_MIN / 60}
              step="0.5"
              inputMode="decimal"
              className="w-20 text-right"
              value={pollInput}
              disabled={loading || saving || !settings.enabled}
              onChange={(e) => setPollInput(e.target.value)}
              onBlur={savePoll}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="proactive-cooldown" className="text-sm text-muted-foreground">
              Snooze dismissed alert (minutes)
            </Label>
            <Input
              id="proactive-cooldown"
              type="number"
              min={0}
              step="1"
              inputMode="numeric"
              className="w-20 text-right"
              value={cooldownInput}
              disabled={loading || saving || !settings.enabled}
              onChange={(e) => setCooldownInput(e.target.value)}
              onBlur={saveCooldown}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </div>
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}
        <p className="text-xs text-muted-foreground">
          Controls how often the assistant checks for a timely nudge while a day is running, and how
          long a dismissed nudge stays hidden. Turn off to silence proactive alerts entirely.
        </p>
      </CardContent>
    </Card>
  );
}
