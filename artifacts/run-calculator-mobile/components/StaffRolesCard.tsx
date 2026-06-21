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
} from "@/context/inventoryShared";
import { useMe } from "@/hooks/useRole";

const MIN_PASSWORD_LENGTH = 6;

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "operator", label: "Operator" },
  { value: "supervisor", label: "Supervisor" },
  { value: "manager", label: "Manager" },
  { value: "qc-operator", label: "QC Op" },
  { value: "qc-manager", label: "QC Mgr" },
  { value: "warehouse", label: "Warehouse" },
  { value: "inventory", label: "Inventory" },
];

function serverMessage(error: unknown, fallback: string): string {
  return error instanceof InventoryApiError && error.serverMessage
    ? error.serverMessage
    : fallback;
}

// Staff & Roles card. The staff roster (view members, change roles, reset a
// forgotten password, remove a departed member) is MANAGER-ONLY. The password-
// reset approval queue is shown to supervisor-or-above (the card is only mounted
// for them), matching the server gates. The server enforces a last-manager
// guard, so failures (demoting or removing the only remaining manager) are
// surfaced inline. Mirrors the web StaffRolesCard.
export default function StaffRolesCard() {
  const colors = useColors();
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
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
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
    onError: (e) =>
      Alert.alert(
        "Could not approve",
        serverMessage(e, "Could not approve request."),
      ),
  });

  const declineMutation = useMutation({
    mutationFn: (id: string) => declinePasswordReset(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["passwordResetRequests"] });
    },
    onError: (e) =>
      Alert.alert(
        "Could not decline",
        serverMessage(e, "Could not decline request."),
      ),
  });

  function confirmDecline(reqItem: PasswordResetRequestItem) {
    Alert.alert(
      "Decline reset request?",
      `This removes ${reqItem.username}'s request without issuing a code.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Decline",
          style: "destructive",
          onPress: () => declineMutation.mutate(reqItem.id),
        },
      ],
    );
  }

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

  const pendingRequests = resetRequestsQuery.data ?? [];

  return (
    <Card title="Staff & Roles" icon="users" style={{ marginBottom: 16 }}>
      {pendingRequests.length > 0 && (
        <View
          style={[
            styles.requestsBox,
            { borderColor: colors.warning ?? colors.primary },
          ]}
        >
          <View style={styles.requestsHeader}>
            <Feather name="shield" size={13} color={colors.warning ?? colors.primary} />
            <Text style={[styles.requestsTitle, { color: colors.warning ?? colors.primary }]}>
              Password reset requests
            </Text>
          </View>
          {pendingRequests.map((reqItem: PasswordResetRequestItem) => (
            <View
              key={reqItem.id}
              style={[
                styles.requestRow,
                { borderColor: colors.border, backgroundColor: colors.background },
              ]}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
                  {reqItem.username}
                </Text>
                <Text style={[styles.sub, { color: colors.mutedForeground }]} numberOfLines={1}>
                  Requested {new Date(reqItem.requestedAt).toLocaleString()}
                </Text>
              </View>
              <View style={styles.requestActions}>
                <Button
                  label="Decline"
                  variant="outline"
                  size="sm"
                  onPress={() => confirmDecline(reqItem)}
                  disabled={approveMutation.isPending || declineMutation.isPending}
                />
                <Button
                  label="Approve"
                  size="sm"
                  onPress={() => approveMutation.mutate(reqItem.id)}
                  disabled={approveMutation.isPending || declineMutation.isPending}
                />
              </View>
            </View>
          ))}
        </View>
      )}
      {isManager && (
        <>
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
                  {ROLE_OPTIONS.map(({ value, label }) => {
                    const active = member.role === value;
                    return (
                      <Pressable
                        key={value}
                        disabled={roleMutation.isPending || active}
                        onPress={() => roleMutation.mutate({ userId: member.userId, role: value })}
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
                          {label}
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
        </>
      )}

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
              <View style={styles.pwWrap}>
                <TextInput
                  style={[
                    styles.input,
                    styles.pwInput,
                    { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background },
                  ]}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  secureTextEntry={!showNewPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholderTextColor={colors.mutedForeground}
                />
                <Pressable
                  style={styles.eyeBtn}
                  onPress={() => setShowNewPassword((s) => !s)}
                  hitSlop={8}
                  accessibilityLabel={showNewPassword ? "Hide password" : "Show password"}
                >
                  <Feather
                    name={showNewPassword ? "eye-off" : "eye"}
                    size={18}
                    color={colors.mutedForeground}
                  />
                </Pressable>
              </View>
            </View>
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Confirm new password</Text>
              <View style={styles.pwWrap}>
                <TextInput
                  style={[
                    styles.input,
                    styles.pwInput,
                    { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background },
                  ]}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showConfirmPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholderTextColor={colors.mutedForeground}
                />
                <Pressable
                  style={styles.eyeBtn}
                  onPress={() => setShowConfirmPassword((s) => !s)}
                  hitSlop={8}
                  accessibilityLabel={showConfirmPassword ? "Hide password" : "Show password"}
                >
                  <Feather
                    name={showConfirmPassword ? "eye-off" : "eye"}
                    size={18}
                    color={colors.mutedForeground}
                  />
                </Pressable>
              </View>
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

      <Modal
        visible={approvedCode !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setApprovedCode(null)}
      >
        <View style={styles.backdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              Reset code for {approvedCode?.username}
            </Text>
            <Text style={[styles.modalDesc, { color: colors.mutedForeground }]}>
              Give this one-time code to {approvedCode?.username} now. It works
              once and won&apos;t be shown again.
            </Text>
            <View
              style={[
                styles.codeBox,
                { backgroundColor: colors.muted, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.codeText, { color: colors.foreground }]}>
                {approvedCode?.code}
              </Text>
            </View>
            {approvedCode ? (
              <Text style={[styles.codeExpiry, { color: colors.mutedForeground }]}>
                Expires {new Date(approvedCode.expiresAt).toLocaleString()}
              </Text>
            ) : null}
            <View style={styles.modalActions}>
              <Button label="Done" size="sm" onPress={() => setApprovedCode(null)} />
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
  toggle: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 4 },
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
  pwWrap: { position: "relative", justifyContent: "center" },
  pwInput: { paddingRight: 44 },
  eyeBtn: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  msg: { fontSize: 12, fontFamily: FONTS.regular },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 },
  requestsBox: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    gap: 8,
    marginBottom: 10,
  },
  requestsHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  requestsTitle: { fontSize: 12, fontFamily: FONTS.bold },
  requestRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  requestActions: { flexDirection: "row", gap: 6, flexShrink: 0 },
  codeBox: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
  },
  codeText: {
    fontSize: 26,
    fontFamily: FONTS.mono,
    letterSpacing: 4,
  },
  codeExpiry: { fontSize: 12, fontFamily: FONTS.regular, textAlign: "center" },
});
