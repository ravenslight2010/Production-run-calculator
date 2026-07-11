import { Bell, Layers } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  NOTIFICATION_KINDS,
  isNotifEnabled,
  type NotificationKind,
  type NotificationPrefs,
} from "../notificationPrefs";

interface AlertSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefs: NotificationPrefs | undefined;
  onTogglePref: (kind: NotificationKind, enabled: boolean) => void;
  floorModeEnabled: boolean;
  onToggleFloorMode: () => void;
}

// Combined per-user "Alerts & Floor Mode" panel, opened from the header menu.
// Every switch here is stored on the ACCOUNT (users.notificationPrefs /
// users.floorModeEnabled via /me) so the choices follow the user across
// devices. Alert toggles are optimistic — the switch flips instantly and
// reconciles with the server's response.
export default function AlertSettingsDialog({
  open,
  onOpenChange,
  prefs,
  onTogglePref,
  floorModeEnabled,
  onToggleFloorMode,
}: AlertSettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5" /> Alerts &amp; Floor Mode
          </DialogTitle>
          <DialogDescription>
            Pick which alerts you want. These settings are saved to your
            account and follow you on any device.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          {NOTIFICATION_KINDS.map(({ kind, label, description }) => (
            <div
              key={kind}
              className="flex items-start justify-between gap-3 py-2.5 border-b border-border/40 last:border-b-0"
            >
              <div className="space-y-0.5">
                <Label htmlFor={`notif-${kind}`} className="text-sm font-medium">
                  {label}
                </Label>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>
              <Switch
                id={`notif-${kind}`}
                checked={isNotifEnabled(prefs, kind)}
                onCheckedChange={(checked) => onTogglePref(kind, checked)}
                data-testid={`switch-notif-${kind}`}
              />
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-border/60 bg-card/50 px-3 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-0.5">
              <Label htmlFor="notif-floor-mode" className="text-sm font-medium flex items-center gap-1.5">
                <Layers className="w-4 h-4" /> Floor Mode
              </Label>
              <p className="text-xs text-muted-foreground">
                Full-screen big-numbers display that opens on its own when the
                screen sits idle during a run.
              </p>
            </div>
            <Switch
              id="notif-floor-mode"
              checked={floorModeEnabled}
              onCheckedChange={() => onToggleFloorMode()}
              data-testid="switch-floor-mode"
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
