import { Feather } from "@expo/vector-icons";
import { Link, useRouter, type Href } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONTS } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import {
  forgotPasswordRequest,
  resetPasswordRequest,
  InventoryApiError,
} from "@/context/inventoryShared";

const MIN_PASSWORD_LENGTH = 6;

type ResetStep = "request" | "verify" | "done";

export default function ForgotPasswordScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const router = useRouter();

  const [step, setStep] = React.useState<ResetStep>("request");
  const [username, setUsername] = React.useState("");
  const [code, setCode] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [showConfirm, setShowConfirm] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const handleRequest = async () => {
    setError(null);
    setBusy(true);
    try {
      await forgotPasswordRequest(username.trim());
      // Always succeeds (enumeration-safe); advance to code entry regardless.
      setStep("verify");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await resetPasswordRequest(username.trim(), code.trim(), password);
      setStep("done");
    } catch (err) {
      if (err instanceof InventoryApiError && err.status === 401) {
        setError("That reset code is invalid or has expired.");
      } else if (err instanceof InventoryApiError && err.serverMessage) {
        setError(err.serverMessage);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  const styles = makeStyles(colors);

  const subtitle =
    step === "request"
      ? "Enter your username to request a reset"
      : step === "verify"
        ? "Enter the code your manager gives you"
        : "Your password has been reset";

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, minHeight: windowHeight, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.screen,
          { paddingTop: insets.top + 24, minHeight: windowHeight },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <Text style={styles.brandName}>Reset your password</Text>
          <Text style={styles.brandTag}>{subtitle}</Text>
        </View>

        <View style={styles.card}>
          {step === "request" && (
            <>
              <Text style={styles.label}>Username</Text>
              <TextInput
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                value={username}
                placeholder="Enter username"
                placeholderTextColor={colors.mutedForeground}
                onChangeText={setUsername}
              />

              {error && <Text style={styles.error}>{error}</Text>}

              <Pressable
                style={[styles.primaryBtn, (!username || busy) && styles.btnDisabled]}
                onPress={handleRequest}
                disabled={!username || busy}
              >
                {busy ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Text style={styles.primaryBtnText}>Request reset</Text>
                )}
              </Pressable>
            </>
          )}

          {step === "verify" && (
            <>
              <Text style={styles.info}>
                Ask your manager to approve your request. They&apos;ll give you a
                one-time code to enter below.
              </Text>

              <Text style={styles.label}>Reset code</Text>
              <TextInput
                style={styles.input}
                autoCapitalize="characters"
                autoCorrect={false}
                value={code}
                placeholder="XXXX-XXXX"
                placeholderTextColor={colors.mutedForeground}
                onChangeText={setCode}
              />

              <Text style={styles.label}>New password</Text>
              <View style={styles.pwWrap}>
                <TextInput
                  style={[styles.input, styles.pwInput]}
                  value={password}
                  placeholder="Enter new password"
                  placeholderTextColor={colors.mutedForeground}
                  secureTextEntry={!showPassword}
                  autoComplete="new-password"
                  onChangeText={setPassword}
                />
                <Pressable
                  style={styles.eyeBtn}
                  onPress={() => setShowPassword((s) => !s)}
                  hitSlop={8}
                  accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                >
                  <Feather
                    name={showPassword ? "eye-off" : "eye"}
                    size={18}
                    color={colors.mutedForeground}
                  />
                </Pressable>
              </View>

              <View style={styles.hintRow}>
                <Feather
                  name="check"
                  size={13}
                  color={
                    password.length >= MIN_PASSWORD_LENGTH
                      ? colors.success
                      : colors.mutedForeground
                  }
                  style={{
                    opacity: password.length >= MIN_PASSWORD_LENGTH ? 1 : 0.4,
                  }}
                />
                <Text
                  style={[
                    styles.hint,
                    {
                      color:
                        password.length >= MIN_PASSWORD_LENGTH
                          ? colors.success
                          : colors.mutedForeground,
                    },
                  ]}
                >
                  At least {MIN_PASSWORD_LENGTH} characters
                </Text>
              </View>

              <Text style={styles.label}>Confirm new password</Text>
              <View style={styles.pwWrap}>
                <TextInput
                  style={[styles.input, styles.pwInput]}
                  value={confirm}
                  placeholder="Re-enter new password"
                  placeholderTextColor={colors.mutedForeground}
                  secureTextEntry={!showConfirm}
                  autoComplete="new-password"
                  onChangeText={setConfirm}
                />
                <Pressable
                  style={styles.eyeBtn}
                  onPress={() => setShowConfirm((s) => !s)}
                  hitSlop={8}
                  accessibilityLabel={showConfirm ? "Hide password" : "Show password"}
                >
                  <Feather
                    name={showConfirm ? "eye-off" : "eye"}
                    size={18}
                    color={colors.mutedForeground}
                  />
                </Pressable>
              </View>

              {error && <Text style={styles.error}>{error}</Text>}

              <Pressable
                style={[
                  styles.primaryBtn,
                  (!code || !password || !confirm || busy) && styles.btnDisabled,
                ]}
                onPress={handleReset}
                disabled={!code || !password || !confirm || busy}
              >
                {busy ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Text style={styles.primaryBtnText}>Reset password</Text>
                )}
              </Pressable>
            </>
          )}

          {step === "done" && (
            <>
              <Text style={styles.info}>
                Your password has been reset. You can now sign in with your new
                password.
              </Text>
              <Pressable
                style={styles.primaryBtn}
                onPress={() => router.replace("/sign-in" as Href)}
              >
                <Text style={styles.primaryBtnText}>Go to sign in</Text>
              </Pressable>
            </>
          )}

          {step !== "done" && (
            <View style={styles.footer}>
              <Link href={"/sign-in" as Href} asChild>
                <Pressable>
                  <Text style={styles.footerLink}>Back to sign in</Text>
                </Pressable>
              </Link>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    screen: {
      flexGrow: 1,
      paddingHorizontal: 24,
      paddingBottom: 40,
      backgroundColor: colors.background,
    },
    brand: { alignItems: "center", marginTop: 24, marginBottom: 28 },
    brandName: {
      fontFamily: FONTS.bold,
      fontSize: 22,
      color: colors.foreground,
      textAlign: "center",
    },
    brandTag: {
      fontFamily: FONTS.regular,
      fontSize: 14,
      color: colors.mutedForeground,
      marginTop: 4,
      textAlign: "center",
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: 20,
    },
    info: {
      fontFamily: FONTS.regular,
      fontSize: 13,
      color: colors.mutedForeground,
      backgroundColor: colors.muted,
      borderRadius: 10,
      padding: 12,
      marginBottom: 16,
    },
    label: {
      fontFamily: FONTS.medium,
      fontSize: 13,
      color: colors.foreground,
      marginBottom: 6,
    },
    input: {
      height: 48,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.input,
      backgroundColor: colors.background,
      paddingHorizontal: 14,
      fontFamily: FONTS.regular,
      fontSize: 15,
      color: colors.foreground,
      marginBottom: 14,
    },
    pwWrap: { position: "relative", justifyContent: "center" },
    pwInput: { paddingRight: 48 },
    hintRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginTop: -8,
      marginBottom: 14,
    },
    hint: { fontFamily: FONTS.regular, fontSize: 12 },
    eyeBtn: {
      position: "absolute",
      right: 0,
      top: 0,
      height: 48,
      width: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryBtn: {
      height: 48,
      borderRadius: 10,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 4,
    },
    primaryBtnText: {
      fontFamily: FONTS.semibold,
      fontSize: 16,
      color: colors.primaryForeground,
    },
    btnDisabled: { opacity: 0.5 },
    error: {
      fontFamily: FONTS.regular,
      fontSize: 13,
      color: colors.destructive,
      marginTop: -4,
      marginBottom: 12,
    },
    footer: {
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      marginTop: 20,
    },
    footerLink: { fontFamily: FONTS.semibold, fontSize: 14, color: colors.primary },
  });
}
