import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Shield,
  ShieldCheck,
  Loader2,
  Plus,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronRight,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
  CAPABILITIES,
  CAPABILITY_LABELS,
  createRoleRequest,
  deleteRoleRequest,
  fetchRoles,
  fetchStaff,
  InventoryApiError,
  setStaffRole,
  updateRoleRequest,
  type Capability,
  type Role,
  type RoleDefinition,
  type StaffMember,
} from "../inventoryShared";
import { useMe } from "../useRole";

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

// Dedicated, role-centric management surface (manage-staff). Lists every role
// with its capabilities and how many staff hold it, lets a manager create,
// rename, edit the capabilities of, and delete roles, and — from the same
// place — see who holds each role and reassign them. Mirrors the mobile
// RolesManager. The server enforces the guardrails (can't grant capabilities
// you lack, can't rename/delete built-ins, can't strand the last manage-staff
// holder, can't delete an assigned role), so failures surface inline.
export default function RolesManager() {
  const qc = useQueryClient();
  const { me, capabilities, hasCapability } = useMe();
  const canManageStaff = hasCapability("manage-staff");

  const rolesQuery = useQuery({
    queryKey: ["roles"],
    queryFn: fetchRoles,
    enabled: canManageStaff,
  });
  const staffQuery = useQuery({
    queryKey: ["staff"],
    queryFn: fetchStaff,
    enabled: canManageStaff,
  });

  const roles: RoleDefinition[] = rolesQuery.data ?? [];
  const staff: StaffMember[] = staffQuery.data ?? [];

  // Role editor dialog state. `editing` is the role being edited, "new" for a
  // fresh role, or null when closed. `originalName` tracks the name at open so a
  // rename can address the role by its current name.
  const [editing, setEditing] = useState<RoleDefinition | "new" | null>(null);
  const [originalName, setOriginalName] = useState("");
  const [roleName, setRoleName] = useState("");
  const [roleCaps, setRoleCaps] = useState<Capability[]>([]);
  const [roleClientError, setRoleClientError] = useState<string | null>(null);
  const [deleteRoleTarget, setDeleteRoleTarget] =
    useState<RoleDefinition | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const saveRoleMutation = useMutation({
    mutationFn: ({
      mode,
      name,
      caps,
      prevName,
    }: {
      mode: "new" | "edit";
      name: string;
      caps: Capability[];
      prevName: string;
    }) =>
      mode === "new"
        ? createRoleRequest(name, caps)
        : updateRoleRequest(prevName, caps, name),
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

  const reassignMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      setStaffRole(userId, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });

  function openRoleEditor(target: RoleDefinition | "new") {
    saveRoleMutation.reset();
    setRoleClientError(null);
    setEditing(target);
    if (target === "new") {
      setOriginalName("");
      setRoleName("");
      setRoleCaps([]);
    } else {
      setOriginalName(target.name);
      setRoleName(target.name);
      setRoleCaps([...target.capabilities]);
    }
  }

  function closeRoleEditor() {
    setEditing(null);
    setOriginalName("");
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
    const name = roleName.trim();
    if (!name) {
      setRoleClientError("Role name is required.");
      return;
    }
    saveRoleMutation.mutate({ mode, name, caps: roleCaps, prevName: originalName });
  }

  // Built-in roles can't be renamed; the manager role must keep manage-staff.
  const editingRole =
    editing !== null && editing !== "new" ? editing : null;
  const editingIsBuiltin = editingRole?.builtin ?? false;
  const editingIsManagerRole =
    editingIsBuiltin && editingRole?.name === "manager";

  // How many staff hold each role, plus the members themselves (for the
  // expandable per-role roster). Counts come from the staff list so no extra
  // contract is needed.
  function membersOf(name: string): StaffMember[] {
    return staff.filter((m) => m.role === name);
  }

  if (!canManageStaff) {
    return (
      <Card className="bg-card/50 border-border/50 shadow-md">
        <CardContent className="px-5 py-6">
          <p className="text-sm text-muted-foreground text-center">
            Managing roles requires the Manage staff &amp; roles capability.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card/50 border-border/50 shadow-md">
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Shield className="w-4 h-4" /> Roles
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => openRoleEditor("new")}
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> New role
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        <p className="text-xs text-muted-foreground">
          Create roles, choose what each one can do, and assign staff to them.
          Built-in roles can't be renamed or deleted.
        </p>
        {rolesQuery.isLoading && (
          <p className="text-xs text-muted-foreground italic flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading roles…
          </p>
        )}
        {rolesQuery.error && (
          <p className="text-xs text-red-500">Could not load roles.</p>
        )}
        {deleteRoleMutation.isError && (
          <p className="text-xs text-red-500">
            {serverMessage(deleteRoleMutation.error, "Could not delete role.")}
          </p>
        )}
        {reassignMutation.isError && (
          <p className="text-xs text-red-500">
            {serverMessage(reassignMutation.error, "Could not change role.")}
          </p>
        )}
        {roles.map((r) => {
          const members = membersOf(r.name);
          const isOpen = !!expanded[r.name];
          return (
            <div
              key={r.name}
              className="rounded-md border border-border/40 bg-muted/10"
            >
              <div className="flex items-start justify-between gap-3 px-3 py-2.5">
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
              <button
                type="button"
                className="w-full flex items-center gap-1.5 border-t border-border/40 px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                onClick={() =>
                  setExpanded((prev) => ({ ...prev, [r.name]: !prev[r.name] }))
                }
                aria-expanded={isOpen}
              >
                {isOpen ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
                <Users className="w-3.5 h-3.5" />
                {members.length} {members.length === 1 ? "person" : "people"}
              </button>
              {isOpen && (
                <div className="space-y-1.5 px-3 pb-2.5">
                  {members.length === 0 && (
                    <p className="text-[11px] text-muted-foreground italic">
                      No one holds this role yet.
                    </p>
                  )}
                  {members.map((member) => {
                    const isSelf = me?.userId === member.userId;
                    return (
                      <div
                        key={member.userId}
                        className="flex items-center justify-between gap-3 rounded-md border border-border/40 bg-background/60 px-2.5 py-1.5"
                      >
                        <p className="text-xs font-medium truncate">
                          {member.name || member.email || member.userId}
                          {isSelf && (
                            <span className="ml-1.5 text-[10px] font-bold uppercase text-muted-foreground">
                              (you)
                            </span>
                          )}
                        </p>
                        <select
                          className="h-7 rounded-md border border-border/60 bg-background px-2 text-xs font-semibold text-foreground disabled:opacity-50"
                          value={member.role}
                          disabled={reassignMutation.isPending}
                          onChange={(e) =>
                            reassignMutation.mutate({
                              userId: member.userId,
                              role: e.target.value as Role,
                            })
                          }
                          aria-label={`Role for ${member.name || member.userId}`}
                        >
                          {!roles.some((rr) => rr.name === member.role) && (
                            <option value={member.role}>
                              {roleLabel(member.role)}
                            </option>
                          )}
                          {roles.map((rr) => (
                            <option key={rr.name} value={rr.name}>
                              {roleLabel(rr.name)}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
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
                {editing === "new" ? "New role" : `Edit ${roleLabel(originalName)}`}
              </DialogTitle>
              <DialogDescription>
                Name the role and choose the capabilities it grants. You can only
                grant capabilities you have yourself.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
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
                  disabled={editingIsBuiltin}
                />
                {editingIsBuiltin && (
                  <p className="text-[10px] text-muted-foreground">
                    Built-in roles can't be renamed.
                  </p>
                )}
              </div>
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
                        actorHas && !lockManageStaff ? "" : "opacity-50"
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
    </Card>
  );
}
