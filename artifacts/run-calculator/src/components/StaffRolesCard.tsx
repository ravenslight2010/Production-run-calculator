import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users,
  Loader2,
  MoreVertical,
  KeyRound,
  Trash2,
  ShieldCheck,
  Eye,
  EyeOff,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  approvePasswordReset,
  declinePasswordReset,
  deleteStaffMember,
  fetchPasswordResetRequests,
  fetchStaff,
  InventoryApiError,
  resetStaffPassword,
  setStaffRole,
  type ApproveResetResult,
  type PasswordResetRequestItem,
  type Role,
  type StaffMember,
} from "../inventoryShared";
import { useMe } from "../useRole";

const MIN_PASSWORD_LENGTH = 6;

function serverMessage(error: unknown, fallback: string): string {
  return error instanceof InventoryApiError && error.serverMessage
    ? error.serverMessage
    : fallback;
}

function PasswordInput(props: React.ComponentProps<typeof Input>) {
  const [show, setShow] = useState(false);
  const { className, ...rest } = props;
  return (
    <div className="relative">
      <Input
        {...rest}
        type={show ? "text" : "password"}
        className={`pr-10 ${className ?? ""}`}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        tabIndex={-1}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

// Staff & Roles card. The staff roster (view members, change roles, reset a
// forgotten password, remove a departed member) is MANAGER-ONLY. The password-
// reset approval queue is shown to supervisor-or-above (the card is only mounted
// for them), matching the server gates. The server enforces a last-manager
// guard, so failures (demoting or removing the only remaining manager) are
// surfaced inline.
export default function StaffRolesCard() {
  const qc = useQueryClient();
  const { me, isManager } = useMe();
  const { data, isLoading, error } = useQuery({
    queryKey: ["staff"],
    queryFn: fetchStaff,
    // The roster endpoint (GET /users) is manager-only; supervisors viewing the
    // card for the reset queue must not fire it (it would 403).
    enabled: isManager,
  });

  const [resetTarget, setResetTarget] = useState<StaffMember | null>(null);
  const [removeTarget, setRemoveTarget] = useState<StaffMember | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetClientError, setResetClientError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);
  const [approvedCode, setApprovedCode] = useState<ApproveResetResult | null>(
    null,
  );

  const resetRequestsQuery = useQuery({
    queryKey: ["passwordResetRequests"],
    queryFn: fetchPasswordResetRequests,
    // Poll so a manager sees new requests without manually refreshing.
    refetchInterval: 20_000,
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => approvePasswordReset(id),
    onSuccess: (result) => {
      setApprovedCode(result);
      qc.invalidateQueries({ queryKey: ["passwordResetRequests"] });
    },
  });

  const declineMutation = useMutation({
    mutationFn: (id: string) => declinePasswordReset(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["passwordResetRequests"] });
    },
  });

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      setStaffRole(userId, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });

  const resetMutation = useMutation({
    mutationFn: ({ userId, password }: { userId: string; password: string }) =>
      resetStaffPassword(userId, password),
    onSuccess: (_data, vars) => {
      const name =
        data?.find((m) => m.userId === vars.userId)?.name ?? "the user";
      closeReset();
      setResetSuccess(`Password reset for ${name}.`);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => deleteStaffMember(userId),
    onSuccess: () => {
      setRemoveTarget(null);
      qc.invalidateQueries({ queryKey: ["staff"] });
    },
  });

  const staff: StaffMember[] = data ?? [];

  function closeReset() {
    setResetTarget(null);
    setNewPassword("");
    setConfirmPassword("");
    setResetClientError(null);
  }

  function submitReset(e: React.FormEvent) {
    e.preventDefault();
    setResetClientError(null);
    if (!resetTarget) return;
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setResetClientError(
        `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      setResetClientError("Passwords do not match.");
      return;
    }
    resetMutation.mutate({ userId: resetTarget.userId, password: newPassword });
  }

  return (
    <Card className="bg-card/50 border-border/50 shadow-md">
      <CardHeader className="pb-2 pt-4 px-5">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Users className="w-4 h-4" /> Staff &amp; Roles
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        {(resetRequestsQuery.data ?? []).length > 0 && (
          <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" /> Password reset requests
            </p>
            {(resetRequestsQuery.data ?? []).map(
              (reqItem: PasswordResetRequestItem) => (
                <div
                  key={reqItem.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border/40 bg-background/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {reqItem.username}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Requested{" "}
                      {new Date(reqItem.requestedAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        approveMutation.isPending || declineMutation.isPending
                      }
                      onClick={() => declineMutation.mutate(reqItem.id)}
                    >
                      {declineMutation.isPending &&
                        declineMutation.variables === reqItem.id && (
                          <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                        )}
                      Decline
                    </Button>
                    <Button
                      size="sm"
                      disabled={
                        approveMutation.isPending || declineMutation.isPending
                      }
                      onClick={() => approveMutation.mutate(reqItem.id)}
                    >
                      {approveMutation.isPending &&
                        approveMutation.variables === reqItem.id && (
                          <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                        )}
                      Approve
                    </Button>
                  </div>
                </div>
              ),
            )}
            {approveMutation.isError && (
              <p className="text-xs text-red-500">
                {serverMessage(
                  approveMutation.error,
                  "Could not approve request.",
                )}
              </p>
            )}
            {declineMutation.isError && (
              <p className="text-xs text-red-500">
                {serverMessage(
                  declineMutation.error,
                  "Could not decline request.",
                )}
              </p>
            )}
          </div>
        )}
        {isManager && (
          <>
        {isLoading && (
          <p className="text-xs text-muted-foreground italic flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading staff…
          </p>
        )}
        {error && (
          <p className="text-xs text-red-500">Could not load staff list.</p>
        )}
        {roleMutation.isError && (
          <p className="text-xs text-red-500">
            {serverMessage(roleMutation.error, "Could not update role.")}
          </p>
        )}
        {removeMutation.isError && (
          <p className="text-xs text-red-500">
            {serverMessage(removeMutation.error, "Could not remove staff member.")}
          </p>
        )}
        {resetSuccess && (
          <p className="text-xs text-green-600">{resetSuccess}</p>
        )}
        {!isLoading && staff.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No staff yet. Members appear here after they sign in.
          </p>
        )}
        {staff.map((member) => {
          const isSelf = me?.userId === member.userId;
          return (
            <div
              key={member.userId}
              className="flex items-center justify-between gap-3 rounded-md border border-border/40 bg-muted/10 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {member.name || member.email || member.userId}
                  {isSelf && (
                    <span className="ml-1.5 text-[10px] font-bold uppercase text-muted-foreground">
                      (you)
                    </span>
                  )}
                </p>
                {member.email && member.name && (
                  <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <select
                  className="h-8 rounded-md border border-border/60 bg-background px-2 text-xs font-semibold text-foreground disabled:opacity-50"
                  value={member.role}
                  disabled={roleMutation.isPending}
                  onChange={(e) =>
                    roleMutation.mutate({
                      userId: member.userId,
                      role: e.target.value as Role,
                    })
                  }
                >
                  <option value="operator">Operator</option>
                  <option value="supervisor">Supervisor</option>
                  <option value="manager">Manager</option>
                  <option value="qc-operator">QC Operator</option>
                  <option value="qc-manager">QC Manager</option>
                  <option value="warehouse">Warehouse</option>
                  <option value="inventory">Inventory</option>
                </select>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      aria-label={`Actions for ${member.name || member.userId}`}
                    >
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => {
                        setResetSuccess(null);
                        setResetTarget(member);
                      }}
                    >
                      <KeyRound className="w-4 h-4 mr-2" /> Reset password
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-red-600 focus:text-red-600"
                      onSelect={() => {
                        removeMutation.reset();
                        setRemoveTarget(member);
                      }}
                    >
                      <Trash2 className="w-4 h-4 mr-2" /> Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          );
        })}
          </>
        )}
      </CardContent>

      {/* Reset password dialog */}
      <Dialog
        open={resetTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeReset();
        }}
      >
        <DialogContent>
          <form onSubmit={submitReset}>
            <DialogHeader>
              <DialogTitle>Reset password</DialogTitle>
              <DialogDescription>
                Set a new password for{" "}
                <span className="font-medium text-foreground">
                  {resetTarget?.name || resetTarget?.userId}
                </span>
                . Share it with them so they can sign in and change it.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="reset-new-password" className="text-xs">
                  New password
                </Label>
                <PasswordInput
                  id="reset-new-password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reset-confirm-password" className="text-xs">
                  Confirm new password
                </Label>
                <PasswordInput
                  id="reset-confirm-password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              {resetClientError && (
                <p className="text-xs text-red-500">{resetClientError}</p>
              )}
              {resetMutation.isError && (
                <p className="text-xs text-red-500">
                  {serverMessage(resetMutation.error, "Could not reset password.")}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={closeReset}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={resetMutation.isPending || !newPassword || !confirmPassword}
              >
                {resetMutation.isPending && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                )}
                Reset password
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Approved reset code (shown once to relay to the user) */}
      <Dialog
        open={approvedCode !== null}
        onOpenChange={(open) => {
          if (!open) setApprovedCode(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset code for {approvedCode?.username}</DialogTitle>
            <DialogDescription>
              Give this one-time code to {approvedCode?.username} now. It works
              once and won't be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <p className="rounded-lg border border-border bg-muted px-4 py-4 text-center font-mono text-2xl font-bold tracking-widest text-foreground">
              {approvedCode?.code}
            </p>
            {approvedCode && (
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Expires {new Date(approvedCode.expiresAt).toLocaleString()}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              size="sm"
              onClick={() => setApprovedCode(null)}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove confirmation */}
      <AlertDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove staff member?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes{" "}
              <span className="font-medium text-foreground">
                {removeTarget?.name || removeTarget?.userId}
              </span>
              . They will lose access immediately and this cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              onClick={(e) => {
                e.preventDefault();
                if (removeTarget) removeMutation.mutate(removeTarget.userId);
              }}
              disabled={removeMutation.isPending}
            >
              {removeMutation.isPending && (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
              )}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
