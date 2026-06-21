import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, Button } from "@/components/UI";
import { useColors } from "@/hooks/useColors";
import { FONTS } from "@/constants/fonts";
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
} from "@/context/inventoryShared";
import { useMe } from "@/hooks/useRole";

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
// place — see who holds each role and reassign them. Mirrors the web
// RolesManager. The server enforces the guardrails (can't grant capabilities
// you lack, can't rename/delete built-ins, can't strand the last manage-staff
// holder, can't delete an assigned role), so failures surface inline.
export default function RolesManager() {
  const colors = useColors();
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

  // Role editor state. `editing` is the role being edited, "new" for a fresh
  // role, or null when closed. `originalName` tracks the name at open so a
  // rename can address the role by its current name.
  const [editing, setEditing] = useState<RoleDefinition | "new" | null>(null);
  const [originalName, setOriginalName] = useState("");
  const [roleName, setRoleName] = useState("");
  const [roleCaps, setRoleCaps] = useState<Capability[]>([]);
  const [roleError, setRoleError] = useState<string | null>(null);
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
    onError: (e) => setRoleError(serverMessage(e, "Could not save role.")),
  });

  const deleteRoleMutation = useMutation({
    mutationFn: (name: string) => deleteRoleRequest(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["roles"] }),
    onError: (e) =>
      Alert.alert("Could not delete", serverMessage(e, "Could not delete role.")),
  });

  const reassignMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      setStaffRole(userId, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e) =>
      Alert.alert("Could not change role", serverMessage(e, "Could not change role.")),
  });

  function openRoleEditor(target: RoleDefinition | "new") {
    saveRoleMutation.reset();
    setRoleError(null);
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
    setRoleError(null);
  }

  function toggleRoleCap(cap: Capability) {
    setRoleCaps((prev) =>
      prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap],
    );
  }

  function submitRole() {
    setRoleError(null);
    const mode = editing === "new" ? "new" : "edit";
    const name = roleName.trim();
    if (!name) {
      setRoleError("Role name is required.");
      return;
    }
    saveRoleMutation.mutate({ mode, name, caps: roleCaps, prevName: originalName });
  }

  function confirmDeleteRole(role: RoleDefinition) {
    Alert.alert(
      "Delete role?",
      `This permanently removes the ${roleLabel(role.name)} role. You can't delete a role that is still assigned to someone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteRoleMutation.mutate(role.name),
        },
      ],
    );
  }

  // Built-in roles can't be renamed; the manager role must keep manage-staff.
  const editingRole =
    editing !== null && editing !== "new" ? editing : null;
  const editingIsBuiltin = editingRole?.builtin ?? false;
  const editingIsManagerRole =
    editingIsBuiltin && editingRole?.name === "manager";

  function membersOf(name: string): StaffMember[] {
    return staff.filter((m) => m.role === name);
  }

  if (!canManageStaff) {
    return (
      <Card title="Roles" icon="shield" style={{ marginBottom: 16 }}>
        <Text style={[styles.empty, { color: colors.mutedForeground }]}>
          Managing roles requires the Manage staff &amp; roles capability.
        </Text>
      </Card>
    );
  }

  return (
    <Card title="Roles" icon="shield" style={{ marginBottom: 16 }}>
      <View style={styles.headerRow}>
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>
          Create roles, choose what each one can do, and assign staff to them.
          Built-in roles can&apos;t be renamed or deleted.
        </Text>
        <Button
          label="New role"
          icon="plus"
          variant="outline"
          size="sm"
          onPress={() => openRoleEditor("new")}
        />
      </View>
      {rolesQuery.isLoading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.mutedForeground} />
          <Text style={[styles.muted, { color: colors.mutedForeground }]}>Loading roles…</Text>
        </View>
      )}
      {rolesQuery.error ? (
        <Text style={[styles.muted, { color: colors.destructive }]}>Could not load roles.</Text>
      ) : null}
      <View style={{ gap: 8 }}>
        {roles.map((r) => {
          const members = membersOf(r.name);
          const isOpen = !!expanded[r.name];
          return (
            <View
              key={r.name}
              style={[styles.row, { borderColor: colors.border, backgroundColor: colors.background }]}
            >
              <View style={styles.topRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.name, { color: colors.foreground }]}>
                    {roleLabel(r.name)}
                    {r.builtin ? "  · Built-in" : ""}
                  </Text>
                  <Text style={[styles.sub, { color: colors.mutedForeground }]}>
                    {r.capabilities.length === 0
                      ? "No special capabilities"
                      : r.capabilities.map((c) => CAPABILITY_LABELS[c]).join(", ")}
                  </Text>
                </View>
                <View style={styles.requestActions}>
                  <Pressable
                    onPress={() => openRoleEditor(r)}
                    style={[styles.iconBtn, { borderColor: colors.border }]}
                    accessibilityLabel={`Edit ${r.name}`}
                  >
                    <Feather name="edit-2" size={13} color={colors.mutedForeground} />
                  </Pressable>
                  {!r.builtin && (
                    <Pressable
                      onPress={() => confirmDeleteRole(r)}
                      disabled={deleteRoleMutation.isPending}
                      style={[styles.iconBtn, { borderColor: colors.border, opacity: deleteRoleMutation.isPending ? 0.5 : 1 }]}
                      accessibilityLabel={`Delete ${r.name}`}
                    >
                      <Feather name="trash-2" size={13} color={colors.destructive} />
                    </Pressable>
                  )}
                </View>
              </View>
              <Pressable
                onPress={() =>
                  setExpanded((prev) => ({ ...prev, [r.name]: !prev[r.name] }))
                }
                style={[styles.countRow, { borderTopColor: colors.border }]}
                accessibilityLabel={`Show people with ${r.name}`}
              >
                <Feather
                  name={isOpen ? "chevron-down" : "chevron-right"}
                  size={14}
                  color={colors.mutedForeground}
                />
                <Feather name="users" size={13} color={colors.mutedForeground} />
                <Text style={[styles.countText, { color: colors.mutedForeground }]}>
                  {members.length} {members.length === 1 ? "person" : "people"}
                </Text>
              </Pressable>
              {isOpen && (
                <View style={{ gap: 8 }}>
                  {members.length === 0 && (
                    <Text style={[styles.muted, { color: colors.mutedForeground, fontStyle: "italic" }]}>
                      No one holds this role yet.
                    </Text>
                  )}
                  {members.map((member) => {
                    const isSelf = me?.userId === member.userId;
                    const roleNames = roles.some((rr) => rr.name === member.role)
                      ? roles.map((rr) => rr.name)
                      : [member.role, ...roles.map((rr) => rr.name)];
                    return (
                      <View
                        key={member.userId}
                        style={[styles.memberRow, { borderColor: colors.border }]}
                      >
                        <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
                          {member.name || member.email || member.userId}
                          {isSelf ? "  (you)" : ""}
                        </Text>
                        <View style={styles.toggle}>
                          {roleNames.map((value) => {
                            const active = member.role === value;
                            return (
                              <Pressable
                                key={value}
                                disabled={reassignMutation.isPending || active}
                                onPress={() =>
                                  reassignMutation.mutate({ userId: member.userId, role: value })
                                }
                                style={[
                                  styles.toggleBtn,
                                  {
                                    backgroundColor: active ? colors.primary : "transparent",
                                    borderColor: colors.border,
                                    opacity: reassignMutation.isPending ? 0.5 : 1,
                                  },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.toggleText,
                                    { color: active ? colors.primaryForeground : colors.mutedForeground },
                                  ]}
                                >
                                  {roleLabel(value)}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}
      </View>

      {/* Role create/edit modal */}
      <Modal
        visible={editing !== null}
        transparent
        animationType="fade"
        onRequestClose={closeRoleEditor}
      >
        <View style={styles.backdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              {editing === "new" ? "New role" : `Edit ${roleLabel(originalName)}`}
            </Text>
            <Text style={[styles.modalDesc, { color: colors.mutedForeground }]}>
              Name the role and choose the capabilities it grants. You can only
              grant capabilities you have yourself.
            </Text>
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Role name</Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    color: colors.foreground,
                    borderColor: colors.border,
                    backgroundColor: editingIsBuiltin ? colors.muted : colors.background,
                  },
                ]}
                value={roleName}
                onChangeText={setRoleName}
                placeholder="e.g. Line Lead"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="words"
                maxLength={60}
                editable={!editingIsBuiltin}
              />
              {editingIsBuiltin && (
                <Text style={[styles.msg, { color: colors.mutedForeground }]}>
                  Built-in roles can&apos;t be renamed.
                </Text>
              )}
            </View>
            <ScrollView style={{ maxHeight: 260 }}>
              <View style={{ gap: 6 }}>
                {CAPABILITIES.map((cap) => {
                  const actorHas = capabilities.includes(cap);
                  const lockManageStaff = editingIsManagerRole && cap === "manage-staff";
                  const checked = roleCaps.includes(cap);
                  const disabled = !actorHas || lockManageStaff;
                  return (
                    <Pressable
                      key={cap}
                      disabled={disabled}
                      onPress={() => toggleRoleCap(cap)}
                      style={[styles.capRow, { opacity: disabled ? 0.5 : 1 }]}
                    >
                      <View
                        style={[
                          styles.capBox,
                          {
                            borderColor: colors.border,
                            backgroundColor: checked ? colors.primary : "transparent",
                          },
                        ]}
                      >
                        {checked && (
                          <Feather name="check" size={12} color={colors.primaryForeground} />
                        )}
                      </View>
                      <Text style={[styles.capLabel, { color: colors.foreground }]}>
                        {CAPABILITY_LABELS[cap]}
                        {lockManageStaff ? "  (required for manager)" : ""}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
            {roleError ? (
              <Text style={[styles.msg, { color: colors.destructive }]}>{roleError}</Text>
            ) : null}
            <View style={styles.modalActions}>
              <Button label="Cancel" variant="outline" size="sm" onPress={closeRoleEditor} />
              <Button
                label={
                  saveRoleMutation.isPending
                    ? "Saving…"
                    : editing === "new"
                      ? "Create role"
                      : "Save changes"
                }
                icon="check"
                size="sm"
                onPress={submitRole}
                disabled={saveRoleMutation.isPending}
              />
            </View>
          </View>
        </View>
      </Modal>
    </Card>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
  },
  intro: { flex: 1, fontSize: 12, fontFamily: FONTS.regular },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  muted: { fontSize: 12, fontFamily: FONTS.regular },
  empty: { fontSize: 13, fontFamily: FONTS.regular, textAlign: "center", paddingVertical: 12 },
  row: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  name: { fontSize: 14, fontFamily: FONTS.medium },
  sub: { fontSize: 12, fontFamily: FONTS.regular },
  countRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderTopWidth: 1,
    paddingTop: 8,
  },
  countText: { fontSize: 12, fontFamily: FONTS.medium },
  memberRow: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  toggle: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  toggleBtn: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  toggleText: { fontSize: 11, fontFamily: FONTS.medium },
  iconBtn: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  requestActions: { flexDirection: "row", gap: 6, flexShrink: 0 },
  capRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  capBox: {
    width: 20,
    height: 20,
    borderWidth: 1,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  capLabel: { fontSize: 13, fontFamily: FONTS.regular, flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    borderWidth: 1,
    borderRadius: 12,
    padding: 20,
    gap: 12,
  },
  modalTitle: { fontSize: 16, fontFamily: FONTS.bold },
  modalDesc: { fontSize: 13, fontFamily: FONTS.regular },
  fieldGroup: { gap: 4 },
  label: { fontSize: 12, fontFamily: FONTS.medium },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: FONTS.regular,
  },
  msg: { fontSize: 12, fontFamily: FONTS.regular },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 },
});
