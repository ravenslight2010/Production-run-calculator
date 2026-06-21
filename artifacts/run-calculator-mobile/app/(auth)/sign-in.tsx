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

export default function SignInScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const router = useRouter();
  const { signIn, signInAsTest } = useAuth();

  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const handleSubmit = async () => {
    setError(null);
    setBusy(true);
    try {
      await signIn(username.trim(), password);
      router.replace("/(tabs)" as Href);
    } catch (err) {
      if (err instanceof InventoryApiError && err.status === 401) {
        setError("Incorrect username or password.");
      } else if (err instanceof InventoryApiError && err.status === 400) {
        setError("Username must be 3–64 characters and password at least 6.");
      } else {
        setError("Something went wrong. Please try again.");
      }
      setBusy(false);
    }
  };

  const handleTestLogin = async () => {
    setError(null);
    setBusy(true);
    try {
      await signInAsTest();
      router.replace("/(tabs)" as Href);
    } catch {
      setError("Could not sign in to the sandbox. Please try again.");
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
          <Text style={styles.brandTag}>Staff access only</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Sign in</Text>

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

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            placeholder="Enter password"
            placeholderTextColor={colors.mutedForeground}
            secureTextEntry
            autoComplete="current-password"
            onChangeText={setPassword}
          />

          <Link href={"/forgot-password" as Href} asChild>
            <Pressable style={styles.forgotWrap}>
              <Text style={styles.forgotLink}>Forgot password?</Text>
            </Pressable>
          </Link>

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            style={[
              styles.primaryBtn,
              (!username || !password || busy) && styles.btnDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!username || !password || busy}
          >
            {busy ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={styles.primaryBtnText}>Sign in</Text>
            )}
          </Pressable>

          <Pressable
            style={[styles.secondaryBtn, busy && styles.btnDisabled]}
            onPress={handleTestLogin}
            disabled={busy}
          >
            <Text style={styles.secondaryBtnText}>Log in as test user (sandbox)</Text>
          </Pressable>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Don&apos;t have an account? </Text>
            <Link href={"/sign-up" as Href} asChild>
              <Pressable>
                <Text style={styles.footerLink}>Create staff account</Text>
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
    secondaryBtn: {
      height: 48,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 10,
    },
    secondaryBtnText: {
      fontFamily: FONTS.semibold,
      fontSize: 15,
      color: colors.foreground,
    },
    btnDisabled: { opacity: 0.5 },
    forgotWrap: { alignSelf: "flex-end", marginTop: -4, marginBottom: 12 },
    forgotLink: {
      fontFamily: FONTS.semibold,
      fontSize: 13,
      color: colors.primary,
    },
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
