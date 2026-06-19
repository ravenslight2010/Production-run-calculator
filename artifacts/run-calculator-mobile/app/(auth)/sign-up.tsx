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
import { useAuth } from "@/context/auth";
import { InventoryApiError } from "@/context/inventoryShared";

const MIN_PASSWORD_LENGTH = 6;

export default function SignUpScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const router = useRouter();
  const { signUp } = useAuth();

  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [showConfirm, setShowConfirm] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const handleSubmit = async () => {
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
      await signUp(username.trim(), password);
      router.replace("/(tabs)" as Href);
    } catch (err) {
      if (err instanceof InventoryApiError && err.status === 409) {
        setError("That username is already taken.");
      } else if (err instanceof InventoryApiError && err.status === 400) {
        setError("Username must be 3–64 characters and password at least 6.");
      } else {
        setError("Something went wrong. Please try again.");
      }
      setBusy(false);
    }
  };

  const styles = makeStyles(colors);

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
          <View style={styles.logo}>
            <Feather name="grid" size={28} color={colors.primaryForeground} />
          </View>
          <Text style={styles.brandName}>Production Run Calculator</Text>
          <Text style={styles.brandTag}>Create your staff account</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Sign up</Text>

          <Text style={styles.label}>Username</Text>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username-new"
            value={username}
            placeholder="Choose a username"
            placeholderTextColor={colors.mutedForeground}
            onChangeText={setUsername}
          />

          <Text style={styles.label}>Password</Text>
          <View style={styles.pwWrap}>
            <TextInput
              style={[styles.input, styles.pwInput]}
              value={password}
              placeholder="Create a password"
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

          <Text style={styles.label}>Confirm password</Text>
          <View style={styles.pwWrap}>
            <TextInput
              style={[styles.input, styles.pwInput]}
              value={confirm}
              placeholder="Re-enter your password"
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
              (!username || !password || !confirm || busy) && styles.btnDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!username || !password || !confirm || busy}
          >
            {busy ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={styles.primaryBtnText}>Create account</Text>
            )}
          </Pressable>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <Link href={"/sign-in" as Href} asChild>
              <Pressable>
                <Text style={styles.footerLink}>Sign in</Text>
              </Pressable>
            </Link>
          </View>
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
    logo: {
      width: 64,
      height: 64,
      borderRadius: 16,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 14,
    },
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
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: 20,
    },
    title: {
      fontFamily: FONTS.bold,
      fontSize: 20,
      color: colors.cardForeground,
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
      flexWrap: "wrap",
    },
    footerText: { fontFamily: FONTS.regular, fontSize: 14, color: colors.mutedForeground },
    footerLink: { fontFamily: FONTS.semibold, fontSize: 14, color: colors.primary },
  });
}
