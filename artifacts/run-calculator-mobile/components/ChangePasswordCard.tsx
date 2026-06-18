import React, { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Card, Button } from "@/components/UI";
import { useColors } from "@/hooks/useColors";
import { FONTS } from "@/constants/fonts";
import { useAuth } from "@/context/auth";
import { InventoryApiError } from "@/context/inventoryShared";

const MIN_PASSWORD_LENGTH = 6;

// Account self-service: lets any signed-in user change their own password.
// Verifies the current password server-side before replacing the stored hash.
// Mirrors the web ChangePasswordCard.
export default function ChangePasswordCard() {
  const colors = useColors();
  const { changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  const onSubmit = async () => {
    setError(null);
    setSuccess(false);
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("New password must be different from the current one.");
      return;
    }
    setPending(true);
    try {
      await changePassword(currentPassword, newPassword);
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (e) {
      setError(
        e instanceof InventoryApiError && e.serverMessage
          ? e.serverMessage
          : "Could not change password. Please try again.",
      );
    } finally {
      setPending(false);
    }
  };

  const field = (
    label: string,
    value: string,
    onChangeText: (t: string) => void,
  ) => (
    <View style={styles.fieldGroup}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        style={[
          styles.input,
          {
            color: colors.foreground,
            borderColor: colors.border,
            backgroundColor: colors.background,
          },
        ]}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={colors.mutedForeground}
      />
    </View>
  );

  return (
    <Card title="Change Password" icon="key" style={{ marginBottom: 16 }}>
      <View style={{ gap: 10 }}>
        {field("Current password", currentPassword, setCurrentPassword)}
        {field("New password", newPassword, setNewPassword)}
        {field("Confirm new password", confirmPassword, setConfirmPassword)}
        {error ? (
          <Text style={[styles.msg, { color: colors.destructive }]}>{error}</Text>
        ) : null}
        {success ? (
          <Text style={[styles.msg, { color: colors.primary }]}>Password updated.</Text>
        ) : null}
        <Button
          label={pending ? "Updating…" : "Update password"}
          icon="check"
          onPress={() => void onSubmit()}
          disabled={
            pending || !currentPassword || !newPassword || !confirmPassword
          }
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
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
});
