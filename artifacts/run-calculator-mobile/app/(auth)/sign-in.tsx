import { useSignIn, useSSO } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import * as AuthSession from "expo-auth-session";
import { Link, useRouter, type Href } from "expo-router";
import * as WebBrowser from "expo-web-browser";
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

// Preload the browser on Android to reduce OAuth latency.
function useWarmUpBrowser() {
  React.useEffect(() => {
    if (Platform.OS !== "android") return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);
}

WebBrowser.maybeCompleteAuthSession();

export default function SignInScreen() {
  useWarmUpBrowser();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const router = useRouter();
  const { signIn, errors, fetchStatus } = useSignIn();
  const { startSSOFlow } = useSSO();

  const [emailAddress, setEmailAddress] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [oauthBusy, setOauthBusy] = React.useState(false);

  const busy = fetchStatus === "fetching" || oauthBusy;

  const navigateHome = ({
    decorateUrl,
  }: {
    session?: { currentTask?: unknown } | null;
    decorateUrl: (url: string) => string;
  }) => {
    const url = decorateUrl("/(tabs)");
    router.replace(url as Href);
  };

  const handleSubmit = async () => {
    const { error } = await signIn.password({ emailAddress, password });
    if (error) return;

    if (signIn.status === "complete") {
      await signIn.finalize({ navigate: navigateHome });
    } else if (signIn.status === "needs_client_trust") {
      const emailCodeFactor = signIn.supportedSecondFactors?.find(
        (f) => f.strategy === "email_code",
      );
      if (emailCodeFactor) await signIn.mfa.sendEmailCode();
    }
  };

  const handleVerify = async () => {
    await signIn.mfa.verifyEmailCode({ code });
    if (signIn.status === "complete") {
      await signIn.finalize({ navigate: navigateHome });
    }
  };

  const handleGoogle = async () => {
    try {
      setOauthBusy(true);
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: "oauth_google",
        redirectUrl: AuthSession.makeRedirectUri(),
      });
      if (createdSessionId && setActive) {
        await setActive({
          session: createdSessionId,
          navigate: async ({ decorateUrl }) => {
            router.replace(decorateUrl("/(tabs)") as Href);
          },
        });
      }
    } catch {
      /* user cancelled or OAuth failed; stay on screen */
    } finally {
      setOauthBusy(false);
    }
  };

  const styles = makeStyles(colors);

  if (signIn.status === "needs_client_trust") {
    return (
      <View
        style={[
          styles.screen,
          { paddingTop: insets.top + 24, minHeight: windowHeight },
        ]}
      >
        <View style={styles.card}>
          <Text style={styles.title}>Verify your account</Text>
          <Text style={styles.subtitle}>Enter the code we emailed you.</Text>
          <TextInput
            style={styles.input}
            value={code}
            placeholder="Verification code"
            placeholderTextColor={colors.mutedForeground}
            onChangeText={setCode}
            keyboardType="numeric"
          />
          {errors.fields.code && (
            <Text style={styles.error}>{errors.fields.code.message}</Text>
          )}
          <Pressable
            style={[styles.primaryBtn, busy && styles.btnDisabled]}
            onPress={handleVerify}
            disabled={busy}
          >
            <Text style={styles.primaryBtnText}>Verify</Text>
          </Pressable>
          <Pressable style={styles.linkBtn} onPress={() => signIn.mfa.sendEmailCode()}>
            <Text style={styles.linkText}>Send a new code</Text>
          </Pressable>
        </View>
      </View>
    );
  }

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

          <Pressable
            style={[styles.googleBtn, busy && styles.btnDisabled]}
            onPress={handleGoogle}
            disabled={busy}
          >
            {oauthBusy ? (
              <ActivityIndicator color={colors.foreground} />
            ) : (
              <>
                <Feather name="log-in" size={18} color={colors.foreground} />
                <Text style={styles.googleBtnText}>Continue with Google</Text>
              </>
            )}
          </Pressable>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <Text style={styles.label}>Email address</Text>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            autoComplete="email"
            value={emailAddress}
            placeholder="you@company.com"
            placeholderTextColor={colors.mutedForeground}
            onChangeText={setEmailAddress}
            keyboardType="email-address"
          />
          {errors.fields.identifier && (
            <Text style={styles.error}>{errors.fields.identifier.message}</Text>
          )}

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
          {errors.fields.password && (
            <Text style={styles.error}>{errors.fields.password.message}</Text>
          )}
          {errors.global?.[0] && (
            <Text style={styles.error}>{errors.global[0].message}</Text>
          )}

          <Pressable
            style={[
              styles.primaryBtn,
              (!emailAddress || !password || busy) && styles.btnDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!emailAddress || !password || busy}
          >
            {fetchStatus === "fetching" && !oauthBusy ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={styles.primaryBtnText}>Continue</Text>
            )}
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
    subtitle: {
      fontFamily: FONTS.regular,
      fontSize: 14,
      color: colors.mutedForeground,
      marginBottom: 16,
    },
    googleBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      height: 48,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    googleBtnText: {
      fontFamily: FONTS.semibold,
      fontSize: 15,
      color: colors.foreground,
    },
    divider: { flexDirection: "row", alignItems: "center", marginVertical: 18 },
    dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
    dividerText: {
      marginHorizontal: 12,
      fontFamily: FONTS.regular,
      fontSize: 13,
      color: colors.mutedForeground,
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
    btnDisabled: { opacity: 0.5 },
    linkBtn: { alignItems: "center", marginTop: 14 },
    linkText: { fontFamily: FONTS.medium, fontSize: 14, color: colors.primary },
    error: {
      fontFamily: FONTS.regular,
      fontSize: 13,
      color: colors.destructive,
      marginTop: -8,
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
