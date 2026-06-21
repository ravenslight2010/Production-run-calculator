import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users,
  Loader2,
  MoreVertical,
  KeyRound,
  Trash2,
  ShieldCheck,
  Shield,
  Plus,
  Pencil,
  Eye,
  EyeOff,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
  CAPABILITIES,
  CAPABILITY_LABELS,
  createRoleRequest,
  declinePasswordReset,
  deleteRoleRequest,
  deleteStaffMember,
  fetchPasswordResetRequests,
  fetchRoles,
  fetchStaff,
  InventoryApiError,
  resetStaffPassword,
  setStaffRole,
  updateRoleRequest,
  type ApproveResetResult,
  type Capability,
  type PasswordResetRequestItem,
  type Role,
  type RoleDefinition,
  type StaffMember,
} from "../inventoryShared";
import { useMe } from "../useRole";

const MIN_PASSWORD_LENGTH = 6;

function serverMessage(error: unknown, fallback: string): string {
  return error instanceof InventoryApiError && error.serverMessage
    ? error.serverMessage
    : fallback;
}

// Turn a stored role name ("qc-manager") into a friendly label ("Qc Manager").
function roleLabel(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
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
// forgotten password, remove a departed member) plus the role editor are gated
// to the manage-staff capability. The password-reset approval queue is gated to
// approve-password-resets. The card is mounted whenever the user has EITHER
// capability; each section gates itself precisely. The server enforces the
// guardrails (last manage-staff holder, can't-grant-capabilities-you-lack,
// can't-delete-an-assigned-role), so failures are surfaced inline.
export default function StaffRolesCard() {
  const qc = useQueryClient();
  const { me, capabilities, hasCapability } = useMe();
  const canManageStaff = hasCapability("manage-staff");
  const canApproveResets = hasCapability("approve-password-resets");

  const { data, isLoading, error } = useQuery({
    queryKey: ["staff"],
    queryFn: fetchStaff,
    // The roster endpoint (GET /users) needs manage-staff; users mounting the
    // card only for the reset queue must not fire it (it would 403).
    enabled: canManageStaff,
  });

  const rolesQuery = useQuery({
    queryKey: ["roles"],
    queryFn: fetchRoles,
    enabled: canManageStaff,
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

  // Role editor dialog state. `editing` is the role being edited, or "new" for
  // a fresh role, or null when closed.
  const [editing, setEditing] = useState<RoleDefinition | "new" | null>(null);
  const [roleName, setRoleName] = useState("");
  const [roleCaps, setRoleCaps] = useState<Capability[]>([]);
  const [roleClientError, setRoleClientError] = useState<string | null>(null);
  const [deleteRoleTarget, setDeleteRoleTarget] =
    useState<RoleDefinition | null>(null);

  const resetRequestsQuery = useQuery({
    queryKey: ["passwordResetRequests"],
    queryFn: fetchPasswordResetRequests,
    // Poll so an approver sees new requests without manually refreshing.
    enabled: canApproveResets,
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

  const saveRoleMutation = useMutation({
    mutationFn: ({
      mode,
      name,
      caps,
    }: {
      mode: "new" | "edit";
      name: string;
      caps: Capability[];
    }) =>
      mode === "new"
        ? createRoleRequest(name, caps)
        : updateRoleRequest(name, caps),
    onSuccess: () => {
      closeRoleEditor();
      qc.invalidateQueries({ queryKey: ["roles"] });
      qc.invalidateQueries({ queryKey: ["staff"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });

  const deleteRoleMutation = useMutation({
    mutationFn: (name: string) => deleteRoleRequest(name),
    onSuccess: () => {
      setDeleteRoleTarget(null);
      qc.invalidateQueries({ queryKey: ["roles"] });
    },
  });

  const staff: StaffMember[] = data ?? [];
  const roles: RoleDefinition[] = rolesQuery.data ?? [];

  function closeReset() {
    setResetTarget(null);
    setNewPassword("");
    setConfirmPassword("");
    setResetClientError(null);
  }

  function openRoleEditor(target: RoleDefinition | "new") {
    saveRoleMutation.reset();
    setRoleClientError(null);
    setEditing(target);
    if (target === "new") {
      setRoleName("");
      setRoleCaps([]);
    } else {
      setRoleName(target.name);
      setRoleCaps([...target.capabilities]);
    }
  }

  function closeRoleEditor() {
    setEditing(null);
    setRoleName("");
    setRoleCaps([]);
    setRoleClientError(null);
  }

  function toggleRoleCap(cap: Capability) {
    setRoleCaps((prev) =>
      prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap],
    );
  }

  function submitRole(e: React.FormEvent) {
    e.preventDefault();
    setRoleClientError(null);
    const mode = editing === "new" ? "new" : "edit";
    const name = mode === "new" ? roleName.trim() : roleName;
    if (mode === "new" && !name) {
      setRoleClientError("Role name is required.");
      return;
    }
    saveRoleMutation.mutate({ mode, name, caps: roleCaps });
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

  // The manager role must always keep manage-staff; reflect that in the editor.
  const editingIsManagerRole =
    editing !== null && editing !== "new" && editing.builtin && editing.name === "manager";

  return (
    <Card className="bg-card/50 border-border/50 shadow-md">
      <CardHeader className="pb-2 pt-4 px-5">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Users className="w-4 h-4" /> Staff &amp; Roles
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        {canApproveResets && (resetRequestsQuery.data ?? []).length > 0 && (
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
        {canManageStaff && (
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
                  {/* If the member's current role isn't in the catalog yet
                      (still loading), keep it as a valid option. */}
                  {!roles.some((r) => r.name === member.role) && (
                    <option value={member.role}>{roleLabel(member.role)}</option>
                  )}
                  {roles.map((r) => (
                    <option key={r.name} value={r.name}>
                      {roleLabel(r.name)}
                    </option>
                  ))}
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

        {/* Roles editor — create/edit/delete the roles that can be assigned. */}
        <div className="pt-2 mt-2 border-t border-border/40 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" /> Roles
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() => openRoleEditor("new")}
            >
              <Plus className="w-3.5 h-3.5 mr-1" /> New role
            </Button>
          </div>
          {rolesQuery.isLoading && (
            <p className="text-xs text-muted-foreground italic flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading roles…
            </p>
          )}
          {deleteRoleMutation.isError && (
            <p className="text-xs text-red-500">
              {serverMessage(deleteRoleMutation.error, "Could not delete role.")}
            </p>
          )}
          {roles.map((r) => (
            <div
              key={r.name}
              className="flex items-start justify-between gap-3 rounded-md border border-border/40 bg-muted/10 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium flex items-center gap-1.5">
                  {roleLabel(r.name)}
                  {r.builtin && (
                    <span className="text-[10px] font-bold uppercase text-muted-foreground border border-border/60 rounded px-1">
                      Built-in
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {r.capabilities.length === 0
                    ? "No special capabilities"
                    : r.capabilities
                        .map((c) => CAPABILITY_LABELS[c])
                        .join(", ")}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label={`Edit ${r.name}`}
                  onClick={() => openRoleEditor(r)}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                {!r.builtin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-red-600 hover:text-red-600"
                    aria-label={`Delete ${r.name}`}
                    onClick={() => {
                      deleteRoleMutation.reset();
                      setDeleteRoleTarget(r);
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
          </>
        )}
      </CardContent>

      {/* Role create/edit dialog */}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) closeRoleEditor();
        }}
      >
        <DialogContent>
          <form onSubmit={submitRole}>
            <DialogHeader>
              <DialogTitle>
                {editing === "new" ? "New role" : `Edit ${roleLabel(roleName)}`}
              </DialogTitle>
              <DialogDescription>
                Choose the capabilities this role grants. You can only grant
                capabilities you have yourself.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              {editing === "new" && (
                <div className="space-y-1.5">
                  <Label htmlFor="role-name" className="text-xs">
                    Role name
                  </Label>
                  <Input
                    id="role-name"
                    value={roleName}
                    onChange={(e) => setRoleName(e.target.value)}
                    placeholder="e.g. Line Lead"
                    maxLength={60}
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label className="text-xs">Capabilities</Label>
                {CAPABILITIES.map((cap) => {
                  const actorHas = capabilities.includes(cap);
                  const lockManageStaff =
                    editingIsManagerRole && cap === "manage-staff";
                  return (
                    <label
                      key={cap}
                      className={`flex items-center gap-2 text-sm ${
                        actorHas && !lockManageStaff
                          ? ""
                          : "opacity-50"
                      }`}
                    >
                      <Checkbox
                        checked={roleCaps.includes(cap)}
                        disabled={!actorHas || lockManageStaff}
                        onCheckedChange={() => toggleRoleCap(cap)}
                      />
                      <span>{CAPABILITY_LABELS[cap]}</span>
                      {lockManageStaff && (
                        <span className="text-[10px] text-muted-foreground">
                          (required for manager)
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
              {roleClientError && (
                <p className="text-xs text-red-500">{roleClientError}</p>
              )}
              {saveRoleMutation.isError && (
                <p className="text-xs text-red-500">
                  {serverMessage(saveRoleMutation.error, "Could not save role.")}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={closeRoleEditor}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={saveRoleMutation.isPending}>
                {saveRoleMutation.isPending && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                )}
                {editing === "new" ? "Create role" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete role confirmation */}
      <AlertDialog
        open={deleteRoleTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteRoleTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete role?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the{" "}
              <span className="font-medium text-foreground">
                {deleteRoleTarget ? roleLabel(deleteRoleTarget.name) : ""}
              </span>{" "}
              role. You can't delete a role that is still assigned to someone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteRoleMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              onClick={(e) => {
                e.preventDefault();
                if (deleteRoleTarget)
                  deleteRoleMutation.mutate(deleteRoleTarget.name);
              }}
              disabled={deleteRoleMutation.isPending}
            >
              {deleteRoleMutation.isPending && (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
              )}
              Delete role
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
