import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
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
  deleteStaffMember,
  fetchStaff,
  InventoryApiError,
  resetStaffPassword,
  setStaffRole,
  type Role,
  type StaffMember,
} from "@/context/inventoryShared";
import { useMe } from "@/hooks/useRole";

const MIN_PASSWORD_LENGTH = 6;

function serverMessage(error: unknown, fallback: string): string {
  return error instanceof InventoryApiError && error.serverMessage
    ? error.serverMessage
    : fallback;
}

// Manager-only UI for viewing every signed-in staff member, changing their
// role, resetting a forgotten password, and removing a departed member. The
// server enforces a last-manager guard, so failures (demoting or removing the
// only remaining manager) are surfaced inline. Mirrors the web StaffRolesCard.
export default function StaffRolesCard() {
  const colors = useColors();
  const qc = useQueryClient();
  const { me } = useMe();
  const { data, isLoading, error } = useQuery({
    queryKey: ["staff"],
    queryFn: fetchStaff,
  });

  const [resetTarget, setResetTarget] = useState<StaffMember | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);

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
    onError: (e) => setResetError(serverMessage(e, "Could not reset password.")),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => deleteStaffMember(userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff"] }),
    onError: (e) =>
      Alert.alert("Could not remove", serverMessage(e, "Could not remove staff member.")),
  });

  const staff: StaffMember[] = data ?? [];

  function closeReset() {
    setResetTarget(null);
    setNewPassword("");
    setConfirmPassword("");
    setResetError(null);
  }

  function submitReset() {
    setResetError(null);
    if (!resetTarget) return;
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setResetError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setResetError("Passwords do not match.");
      return;
    }
    resetMutation.mutate({ userId: resetTarget.userId, password: newPassword });
  }

  function confirmRemove(member: StaffMember) {
    Alert.alert(
      "Remove staff member?",
      `This permanently removes ${member.name || member.userId}. They will lose access immediately and this cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => removeMutation.mutate(member.userId),
        },
      ],
    );
  }

  return (
    <Card title="Staff & Roles" icon="users" style={{ marginBottom: 16 }}>
      {isLoading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.mutedForeground} />
          <Text style={[styles.muted, { color: colors.mutedForeground }]}>Loading staff…</Text>
        </View>
      )}
      {error && (
        <Text style={[styles.muted, { color: colors.destructive }]}>Could not load staff list.</Text>
      )}
      {roleMutation.isError && (
        <Text style={[styles.muted, { color: colors.destructive }]}>
          {serverMessage(roleMutation.error, "Could not update role.")}
        </Text>
      )}
      {resetSuccess && (
        <Text style={[styles.muted, { color: colors.primary }]}>{resetSuccess}</Text>
      )}
      {!isLoading && staff.length === 0 && (
        <Text style={[styles.empty, { color: colors.mutedForeground }]}>
          No staff yet. Members appear here after they sign in.
        </Text>
      )}
      <View style={{ gap: 8 }}>
        {staff.map((member) => {
          const isSelf = me?.userId === member.userId;
          return (
            <View
              key={member.userId}
              style={[styles.row, { borderColor: colors.border, backgroundColor: colors.background }]}
            >
              <View style={styles.topRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
                    {member.name || member.email || member.userId}
                    {isSelf ? "  (you)" : ""}
                  </Text>
                  {member.email && member.name ? (
                    <Text style={[styles.sub, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {member.email}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.toggle}>
                  {(["manager", "operator"] as Role[]).map((r) => {
                    const active = member.role === r;
                    return (
                      <Pressable
                        key={r}
                        disabled={roleMutation.isPending || active}
                        onPress={() => roleMutation.mutate({ userId: member.userId, role: r })}
                        style={[
                          styles.toggleBtn,
                          {
                            backgroundColor: active ? colors.primary : "transparent",
                            borderColor: colors.border,
                            opacity: roleMutation.isPending ? 0.5 : 1,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.toggleText,
                            { color: active ? colors.primaryForeground : colors.mutedForeground },
                          ]}
                        >
                          {r === "manager" ? "Manager" : "Operator"}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <View style={styles.actions}>
                <Pressable
                  onPress={() => {
                    setResetSuccess(null);
                    setResetTarget(member);
                  }}
                  style={[styles.actionBtn, { borderColor: colors.border }]}
                >
                  <Feather name="key" size={13} color={colors.mutedForeground} />
                  <Text style={[styles.actionText, { color: colors.mutedForeground }]}>
                    Reset password
                  </Text>
                </Pressable>
                <Pressable
                  disabled={removeMutation.isPending}
                  onPress={() => confirmRemove(member)}
                  style={[styles.actionBtn, { borderColor: colors.border, opacity: removeMutation.isPending ? 0.5 : 1 }]}
                >
                  <Feather name="trash-2" size={13} color={colors.destructive} />
                  <Text style={[styles.actionText, { color: colors.destructive }]}>Remove</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>

      <Modal
        visible={resetTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={closeReset}
      >
        <View style={styles.backdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Reset password</Text>
            <Text style={[styles.modalDesc, { color: colors.mutedForeground }]}>
              Set a new password for {resetTarget?.name || resetTarget?.userId}. Share it with them so
              they can sign in and change it.
            </Text>
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>New password</Text>
              <TextInput
                style={[
                  styles.input,
                  { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background },
                ]}
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                placeholderTextColor={colors.mutedForeground}
              />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Confirm new password</Text>
              <TextInput
                style={[
                  styles.input,
                  { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background },
                ]}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                placeholderTextColor={colors.mutedForeground}
              />
            </View>
            {resetError ? (
              <Text style={[styles.msg, { color: colors.destructive }]}>{resetError}</Text>
            ) : null}
            <View style={styles.modalActions}>
              <Button label="Cancel" variant="outline" size="sm" onPress={closeReset} />
              <Button
                label={resetMutation.isPending ? "Resetting…" : "Reset password"}
                icon="check"
                size="sm"
                onPress={submitReset}
                disabled={resetMutation.isPending || !newPassword || !confirmPassword}
              />
            </View>
          </View>
        </View>
      </Modal>
    </Card>
  );
}

const styles = StyleSheet.create({
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  muted: { fontSize: 12, fontFamily: FONTS.regular },
  empty: { fontSize: 13, fontFamily: FONTS.regular, textAlign: "center", paddingVertical: 12 },
  row: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  name: { fontSize: 14, fontFamily: FONTS.medium },
  sub: { fontSize: 12, fontFamily: FONTS.regular },
  toggle: { flexDirection: "row", gap: 4 },
  toggleBtn: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  toggleText: { fontSize: 11, fontFamily: FONTS.medium },
  actions: { flexDirection: "row", gap: 8 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  actionText: { fontSize: 11, fontFamily: FONTS.medium },
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
