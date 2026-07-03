import { Link, Stack, useRouter } from "expo-router";
import { useEffect } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { FONTS } from "@/constants/fonts";

export default function NotFoundScreen() {
  const colors = useColors();
  const router = useRouter();

  // Dev-only browser test hook: the workspace preview serves the Expo web app
  // under /mobile/, a pathname expo-router can't match, so every UI test lands
  // on this screen and must click through "Go to home screen!" and then tap
  // its way to the target screen — burning scarce test iterations. In dev on
  // web ONLY, a one-shot route staged in localStorage under "rc_test_route"
  // (e.g. "/schedule") deep-links straight there. The key is consumed before
  // navigating so reloads behave normally. Stripped from production builds by
  // the __DEV__ guard.
  useEffect(() => {
    if (!__DEV__ || Platform.OS !== "web") return;
    let route: string | null = null;
    try {
      route = globalThis.localStorage?.getItem("rc_test_route") ?? null;
      if (route) globalThis.localStorage?.removeItem("rc_test_route");
    } catch {
      return;
    }
    if (route && route.startsWith("/")) {
      router.replace(route as never);
    }
  }, [router]);

  return (
    <>
      <Stack.Screen options={{ title: "Oops!" }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          This screen doesn&apos;t exist.
        </Text>

        <Link href="/" style={styles.link}>
          <Text style={[styles.linkText, { color: colors.primary }]}>
            Go to home screen!
          </Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontFamily: FONTS.bold,
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
  linkText: {
    fontSize: 14,
    fontFamily: FONTS.medium,
  },
});
