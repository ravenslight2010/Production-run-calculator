import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import {
  SpaceMono_400Regular,
  SpaceMono_700Bold,
} from "@expo-google-fonts/space-mono";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setBaseUrl } from "@workspace/api-client-react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider } from "@/context/auth";
import { RunContextProvider } from "@/context/RunContext";
import { reportIncident } from "@/context/inventoryShared";

SplashScreen.preventAutoHideAsync();

// Expo web mounts into #root, which has no intrinsic height. react-native-web's
// flex:1 app tree then measures against a zero-height parent and collapses to a
// blank screen. The HTML shell (with #root) already exists when this bundle is
// evaluated, so we set the heights *synchronously here* — before React renders
// and measures — rather than in a useEffect, which applied too late and left the
// first paint blank. No-op on native.
if (Platform.OS === "web" && typeof document !== "undefined") {
  document.documentElement.style.height = "100%";
  document.body.style.height = "100%";
  document.body.style.margin = "0";
  const root = document.getElementById("root");
  if (root) {
    root.style.height = "100%";
    root.style.display = "flex";
  }
}

const queryClient = new QueryClient();

const domain = process.env.EXPO_PUBLIC_DOMAIN;
if (domain) setBaseUrl(`https://${domain}`);

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerBackTitle: "Back" }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="master-data" options={{ presentation: "card" }} />
      <Stack.Screen name="schedule" options={{ presentation: "card" }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    SpaceMono_400Regular,
    SpaceMono_700Bold,
  });

  // Custom fonts are fetched over the network in Expo Go. If that fetch stalls
  // (e.g. a flaky dev tunnel), gating the whole UI on it would leave the app
  // stuck on a blank/splash screen with no way to recover. After a short
  // timeout we render anyway with system fonts so the app is never blocked.
  const [fontTimedOut, setFontTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFontTimedOut(true), 3000);
    return () => clearTimeout(t);
  }, []);

  const ready = fontsLoaded || !!fontError || fontTimedOut;

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary
        onError={(error, stackTrace) => {
          // Auto-submit a crash incident so a manager sees it even if the user
          // never files a report. Fire-and-forget: a failed report must not mask
          // the original crash. The AI can't edit code — recovery is a safe
          // restart, surfaced by the fallback screen.
          void reportIncident({
            source: "auto_crash",
            screen: "mobile",
            appPlatform: "mobile",
            errorMessage: error.message,
            errorStack: [error.stack, stackTrace].filter(Boolean).join("\n\n"),
            userAgent: `${Platform.OS} ${Platform.Version}`,
          }).catch(() => {});
        }}
      >
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <AuthProvider>
              <RunContextProvider>
                <RootLayoutNav />
              </RunContextProvider>
            </AuthProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
