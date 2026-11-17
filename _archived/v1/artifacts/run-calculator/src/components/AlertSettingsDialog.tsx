import { Bell, BellRing, Layers, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  NOTIFICATION_KINDS,
  isNotifEnabled,
  type NotificationKind,
  type NotificationPrefs,
} from "../notificationPrefs";
import {
  disableWebPush,
  enableWebPush,
  fetchVapidPublicKey,
  getWebPushStatus,
  recoverWebPush,
  type WebPushStatus,
} from "../webPush";

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
  const [push, setPush] = useState<WebPushStatus>({ state: "unsupported" });
  const [confirmRestoreOpen, setConfirmRestoreOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void getWebPushStatus().then((status) => {
      if (active) setPush((current) => current.registrationRejected ? current : status);
    });
    return () => { active = false; };
  }, [open]);

  const enablePush = async () => {
    setPush({
      state: "enabling",
      subscription: push.subscription,
      subscriptionId: push.subscriptionId,
    });
    try {
      setPush(await enableWebPush(await fetchVapidPublicKey()));
    } catch (error) {
      setPush({
        state: "error",
        error: error instanceof Error ? error.message : "Could not enable Web Push.",
        subscription: push.subscription,
        subscriptionId: push.subscriptionId,
      });
    }
  };

  const restorePush = async () => {
    setConfirmRestoreOpen(false);
    setPush({
      state: "enabling",
      subscription: push.subscription,
      subscriptionId: push.subscriptionId,
    });
    try {
      setPush(await recoverWebPush(
        await fetchVapidPublicKey(),
        push.subscription,
        push.subscriptionId,
        push.subscriptionWasExisting,
      ));
    } catch (error) {
      setPush({
        state: "error",
        error: error instanceof Error ? error.message : "Could not restore Web Push.",
        subscription: push.subscription,
        subscriptionId: push.subscriptionId,
        registrationRejected: true,
        subscriptionWasExisting: push.subscriptionWasExisting,
      });
    }
  };

  const disablePush = async () => {
    setPush({ state: "enabling", subscription: push.subscription });
    setPush(await disableWebPush(push.subscription, push.subscriptionId));
  };
  const canSafelyReplaceSubscription = Boolean(push.subscription)
    && !(push.subscriptionWasExisting && !push.subscriptionId);

  const pushCopy: Record<Exclude<WebPushStatus["state"], "error">, string> = {
    unsupported: "This browser does not support Web Push on this device.",
    insecure: "Web Push requires a secure (HTTPS) connection.",
    denied: "Notifications are blocked in your browser settings. Allow them there to enable alerts.",
    available: "Enable this device to receive alerts when the app is closed or in the background.",
    enabling: "Updating this device’s Web Push subscription…",
    enabled: "This device is enabled for Web Push alerts.",
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5" /> Alerts &amp; Floor Mode
          </DialogTitle>
          <DialogDescription>
            Pick which alerts you want. These settings are saved to your
            account and follow you on any device.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border/60 bg-card/50 px-3 py-3 space-y-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <BellRing className="w-4 h-4" /> Web Push on this device
              </Label>
              <p className="text-xs text-muted-foreground">
                {push.state === "error"
                  ? push.registrationRejected
                    ? canSafelyReplaceSubscription
                      ? "The server rejected this device’s saved notification subscription. Alerts may not arrive here until you restore this device. Account alert choices will not change."
                      : "The server rejected this device’s saved notification subscription, but its matching server registration cannot be identified. The browser subscription was left untouched."
                    : push.error
                  : pushCopy[push.state]}
              </p>
            </div>
            {push.state === "enabled" ? (
              <Button variant="outline" size="sm" onClick={() => void disablePush()}
                data-testid="button-disable-web-push">
                Disable
              </Button>
            ) : push.state === "error" && push.registrationRejected && push.subscription ? (
              canSafelyReplaceSubscription ? (
                <Button size="sm" onClick={() => setConfirmRestoreOpen(true)}
                  data-testid="button-restore-web-push">
                  Restore this device
                </Button>
              ) : null
            ) : push.state === "available" || push.state === "error" ? (
              <Button size="sm" onClick={() => void enablePush()} data-testid="button-enable-web-push">
                Enable
              </Button>
            ) : push.state === "enabling" ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" aria-label="Updating Web Push" />
            ) : null}
          </div>
          {push.state === "error" && (
            <p role="alert" className="text-xs text-destructive">
              {push.registrationRejected
                ? "The current browser subscription has not been replaced."
                : "Web Push was not changed. Try again."}
            </p>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Alert kinds below are account settings and follow you across devices. Web Push above only controls this device.
        </p>

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
      <AlertDialog open={confirmRestoreOpen} onOpenChange={setConfirmRestoreOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore Web Push on this device?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove this device’s current browser subscription and
              register a fresh one. Continue only if you want to replace it.
              Your account-level alert choices will stay unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-web-push-restore">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void restorePush()} data-testid="button-confirm-web-push-restore">
              Replace subscription
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
