import { useAuth } from "@/context/auth";
import { BlurView } from "expo-blur";
import { reloadAppAsync } from "expo";
import { Redirect, Tabs, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { Alert, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { FONTS } from "@/constants/fonts";
import { usePendingResetCount } from "@/hooks/usePendingResetCount";
import { useUnreviewedIncidentCount } from "@/hooks/useUnreviewedIncidentCount";
import { useMe } from "@/hooks/useRole";
import ReportIssueModal from "@/components/ReportIssueModal";
import GetStartedModal from "@/components/GetStartedModal";
import GuidedTour from "@/components/GuidedTour";
import ProactiveAlertBanner from "@/components/ProactiveAlertBanner";
import SandboxBanner from "@/components/SandboxBanner";
import { useGetStartedOverview } from "@workspace/onboarding";
import { resetSandboxRequest } from "@/context/inventoryShared";
import { useRun, todayStr, clearLocalStateForSandboxReset } from "@/context/RunContext";
import { buildOptimizeInput } from "@/context/aiOptimize";
import { useProactiveAlert } from "@/context/aiProactive";

const MENU_ITEMS: {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  route: string;
  desc: string;
}[] = [
  { label: "Stoppages", icon: "clock", route: "/stoppages", desc: "Log and review downtime" },
  { label: "Summary", icon: "list", route: "/summary", desc: "Shift totals and export" },
  { label: "Stock", icon: "clipboard", route: "/inventory", desc: "On-hand stock, lots, and restocks" },
  { label: "AI Assistant", icon: "zap", route: "/assistant", desc: "Run, break, and efficiency recommendations" },
  { label: "Schedule", icon: "calendar", route: "/schedule", desc: "Plan future production days" },
  { label: "Setup", icon: "sliders", route: "/configure", desc: "Run config and recipes" },
  { label: "Settings", icon: "settings", route: "/settings", desc: "App options and master data" },
];

export default function TabLayout() {
  const colors = useColors();
  const router = useRouter();
  const { signOut, isLoading, isAuthenticated, me, markOnboardingSeen, markTourCompleted } =
    useAuth();
  const insets = useSafeAreaInsets();
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  // First-login "Get Started" overview. Auto-opens once when the server says
  // this user hasn't seen it yet; reopenable any time from the header menu.
  // Latch + dismiss behavior lives in a shared hook kept at web/mobile parity.
  const {
    open: getStartedOpen,
    setOpen: setGetStartedOpen,
    closeOverview: closeGetStarted,
  } = useGetStartedOverview(me, markOnboardingSeen);
  // Multi-step guided tour that walks through each tab; opened on demand from
  // the Get Started overview or the header menu (never auto-shown).
  const [tourOpen, setTourOpen] = useState(false);
  // Manager-only nav badge: pending password reset requests awaiting approval.
  const pendingResetCount = usePendingResetCount();
  // Manager-only nav badge: reported issues / crashes not yet reviewed.
  const unreviewedIncidentCount = useUnreviewedIncidentCount();
  const { isManager } = useMe();
  const attentionCount = pendingResetCount + unreviewedIncidentCount;

  // ── Proactive shift alerts ────────────────────────────────────────────────
  // Poll the server on a cadence for at most one timely, dismissible nudge.
  // Manager-only; runs even on an idle day so an expiring-stock heads-up can
  // surface before any run begins (the server gates behind-plan/break nudges to
  // an active day and skips the AI call when idle with no at-risk stock). The
  // hook owns cooldown + de-dup (see context/aiProactive.ts). Mounted here
  // (persistent across tab switches) to mirror the web hook in home.tsx
  // (replit.md parity).
  const { allRuns, history, runToTime, scheduled } = useRun();
  const { alert: proactiveAlert, dismiss: dismissProactiveAlert } = useProactiveAlert({
    enabled: isManager,
    buildInput: () =>
      buildOptimizeInput({
        date: todayStr(),
        nowMs: Date.now(),
        runToTime,
        runs: allRuns,
        history,
        scheduledDays: Object.entries(scheduled).map(([date, runs]) => ({
          date,
          runs: runs.map((r) => ({
            brand: r.brand,
            flavor: r.flavor,
            casesNeeded: r.casesNeeded,
            dieType: r.dieType,
          })),
        })),
      }),
  });

  // Sandbox "Reset" — re-copy live → sandbox on the server, then drop this
  // device's local day-state and relaunch so the fresh sandbox state is pulled
  // from the server (the additive live-sync merge would otherwise hide it).
  const runSandboxReset = async () => {
    try {
      await resetSandboxRequest();
      await clearLocalStateForSandboxReset();
    } catch {
      // Best-effort: still relaunch so a partial reset re-pulls cleanly.
    }
    await reloadAppAsync().catch(() => {});
  };
  const doSandboxReset = () => {
    Alert.alert(
      "Reset sandbox",
      "This replaces all sandbox data with a fresh copy of the live data. Live data is not affected. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Reset", style: "destructive", onPress: () => void runSandboxReset() },
      ],
    );
  };

  // Automatic sandbox refresh: when the server reports the sandbox copy is stale
  // (older than its cutoff, or never copied), re-copy live → sandbox and relaunch
  // — the same flow as the manual "Reset" action, minus the confirm. Keeps the
  // demo/training space trustworthy without anyone remembering to reset it.
  // Guarded so it fires at most once per mount, and only for the sandbox account
  // (sandboxStale is always false otherwise).
  const autoSandboxResetRef = useRef(false);
  useEffect(() => {
    if (!me?.sandbox || !me.sandboxStale || autoSandboxResetRef.current) return;
    autoSandboxResetRef.current = true;
    void runSandboxReset();
    // runSandboxReset is stable enough for this one-shot guard; deps track the
    // staleness signal only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.sandbox, me?.sandboxStale]);

  if (!isLoading && !isAuthenticated) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return (
    <>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.mutedForeground,
          headerShown: true,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerShadowVisible: false,
          tabBarLabelStyle: { fontSize: 10 },
          headerRight: () => (
            <Pressable
              onPress={() => setMenuOpen(true)}
              hitSlop={10}
              style={({ pressed }) => [styles.menuBtn, { opacity: pressed ? 0.6 : 1 }]}
              accessibilityLabel={
                attentionCount > 0
                  ? `Menu, ${attentionCount} items need attention`
                  : "Menu"
              }
            >
              <Feather name="menu" size={22} color={colors.foreground} />
              {attentionCount > 0 && (
                <View
                  style={[
                    styles.headerBadge,
                    {
                      backgroundColor: colors.warning ?? colors.primary,
                      borderColor: colors.background,
                    },
                  ]}
                >
                  <Text style={styles.headerBadgeText}>{attentionCount}</Text>
                </View>
              )}
            </Pressable>
          ),
          tabBarStyle: {
            position: "absolute",
            backgroundColor: isIOS ? "transparent" : colors.background,
            borderTopWidth: isWeb ? 1 : StyleSheet.hairlineWidth,
            borderTopColor: colors.border,
            elevation: 0,
            ...(isWeb ? { height: 84 } : {}),
          },
          tabBarBackground: () =>
            isIOS ? (
              <BlurView
                intensity={80}
                tint="dark"
                style={StyleSheet.absoluteFill}
              />
            ) : isWeb ? (
              <View
                style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}
              />
            ) : null,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Run",
            tabBarLabel: "Run",
            tabBarIcon: ({ color }) => <Feather name="bar-chart-2" size={22} color={color} />,
          }}
        />
        <Tabs.Screen
          name="dough"
          options={{
            title: "Dough / Crusts",
            tabBarLabel: "Dough",
            tabBarIcon: ({ color }) => <Feather name="layers" size={22} color={color} />,
          }}
        />
        <Tabs.Screen
          name="sauce"
          options={{
            title: "Sauce",
            tabBarLabel: "Sauce",
            tabBarIcon: ({ color }) => <Feather name="droplet" size={22} color={color} />,
          }}
        />
        <Tabs.Screen
          name="frontline"
          options={{
            title: "Frontline",
            tabBarLabel: "Front",
            tabBarIcon: ({ color }) => <Feather name="grid" size={22} color={color} />,
          }}
        />
        <Tabs.Screen
          name="packaging"
          options={{
            title: "Packaging",
            tabBarLabel: "Pack",
            tabBarIcon: ({ color }) => <Feather name="package" size={22} color={color} />,
          }}
        />
        <Tabs.Screen
          name="warehouse"
          options={{
            title: "Warehouse",
            tabBarLabel: "Whse",
            tabBarIcon: ({ color }) => <Feather name="archive" size={22} color={color} />,
          }}
        />
        {/* Menu-reachable screens (hidden from the bottom tab bar) */}
        <Tabs.Screen name="inventory" options={{ href: null, title: "Inventory" }} />
        <Tabs.Screen name="assistant" options={{ href: null, title: "AI Assistant" }} />
        <Tabs.Screen name="incidents" options={{ href: null, title: "Reported issues" }} />
        <Tabs.Screen name="quality" options={{ href: null, title: "Quality history" }} />
        <Tabs.Screen name="roles" options={{ href: null, title: "Roles" }} />
        <Tabs.Screen name="stoppages" options={{ href: null, title: "Stoppages" }} />
        <Tabs.Screen name="summary" options={{ href: null, title: "Summary" }} />
        <Tabs.Screen name="configure" options={{ href: null, title: "Setup" }} />
        <Tabs.Screen name="settings" options={{ href: null, title: "Settings" }} />
      </Tabs>

      <SandboxBanner visible={!!me?.sandbox} onReset={doSandboxReset} />

      <ProactiveAlertBanner alert={proactiveAlert} onDismiss={dismissProactiveAlert} />

      <Modal
        visible={menuOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setMenuOpen(false)}>
          <Pressable
            style={[
              styles.sheet,
              {
                backgroundColor: colors.card,
                paddingBottom: 24 + insets.bottom,
              },
            ]}
            onPress={() => {}}
          >
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Menu</Text>
            {MENU_ITEMS.map((item) => (
              <Pressable
                key={item.route}
                onPress={() => {
                  setMenuOpen(false);
                  router.push(item.route as never);
                }}
                style={({ pressed }) => [
                  styles.menuItem,
                  {
                    backgroundColor: colors.secondary,
                    borderColor: colors.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <View style={[styles.menuIcon, { backgroundColor: colors.primary + "22" }]}>
                  <Feather name={item.icon} size={18} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.menuItemLabel, { color: colors.foreground }]}>
                    {item.label}
                  </Text>
                  <Text style={[styles.menuItemDesc, { color: colors.mutedForeground }]}>
                    {item.desc}
                  </Text>
                </View>
                {item.route === "/inventory" && pendingResetCount > 0 && (
                  <View
                    style={[
                      styles.menuBadge,
                      { backgroundColor: colors.warning ?? colors.primary },
                    ]}
                  >
                    <Text style={styles.menuBadgeText}>{pendingResetCount}</Text>
                  </View>
                )}
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </Pressable>
            ))}
            <Pressable
              onPress={() => {
                setMenuOpen(false);
                setReportOpen(true);
              }}
              style={({ pressed }) => [
                styles.menuItem,
                {
                  backgroundColor: colors.secondary,
                  borderColor: colors.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <View style={[styles.menuIcon, { backgroundColor: colors.primary + "22" }]}>
                <Feather name="life-buoy" size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.menuItemLabel, { color: colors.foreground }]}>
                  Report an issue
                </Text>
                <Text style={[styles.menuItemDesc, { color: colors.mutedForeground }]}>
                  Get instant help and alert your manager
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </Pressable>
            <Pressable
              onPress={() => {
                setMenuOpen(false);
                setGetStartedOpen(true);
              }}
              style={({ pressed }) => [
                styles.menuItem,
                {
                  backgroundColor: colors.secondary,
                  borderColor: colors.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <View style={[styles.menuIcon, { backgroundColor: colors.primary + "22" }]}>
                <Feather name="box" size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.menuItemLabel, { color: colors.foreground }]}>
                  Get Started
                </Text>
                <Text style={[styles.menuItemDesc, { color: colors.mutedForeground }]}>
                  A quick overview of the app and its tabs
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </Pressable>
            <Pressable
              onPress={() => {
                setMenuOpen(false);
                setTourOpen(true);
              }}
              style={({ pressed }) => [
                styles.menuItem,
                {
                  backgroundColor: colors.secondary,
                  borderColor: colors.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <View style={[styles.menuIcon, { backgroundColor: colors.primary + "22" }]}>
                <Feather name="compass" size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.menuItemLabel, { color: colors.foreground }]}>
                  Guided Tour
                </Text>
                <Text style={[styles.menuItemDesc, { color: colors.mutedForeground }]}>
                  Step through each tab one at a time
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </Pressable>
            {isManager && (
              <Pressable
                onPress={() => {
                  setMenuOpen(false);
                  router.push("/incidents" as never);
                }}
                style={({ pressed }) => [
                  styles.menuItem,
                  {
                    backgroundColor: colors.secondary,
                    borderColor: colors.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <View style={[styles.menuIcon, { backgroundColor: colors.primary + "22" }]}>
                  <Feather name="alert-circle" size={18} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.menuItemLabel, { color: colors.foreground }]}>
                    Reported issues
                  </Text>
                  <Text style={[styles.menuItemDesc, { color: colors.mutedForeground }]}>
                    Review reported problems and crashes
                  </Text>
                </View>
                {unreviewedIncidentCount > 0 && (
                  <View
                    style={[
                      styles.menuBadge,
                      { backgroundColor: colors.warning ?? colors.primary },
                    ]}
                  >
                    <Text style={styles.menuBadgeText}>{unreviewedIncidentCount}</Text>
                  </View>
                )}
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </Pressable>
            )}
            {isManager && (
              <Pressable
                onPress={() => {
                  setMenuOpen(false);
                  router.push("/quality" as never);
                }}
                style={({ pressed }) => [
                  styles.menuItem,
                  {
                    backgroundColor: colors.secondary,
                    borderColor: colors.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <View style={[styles.menuIcon, { backgroundColor: colors.primary + "22" }]}>
                  <Feather name="shield" size={18} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.menuItemLabel, { color: colors.foreground }]}>
                    Quality history
                  </Text>
                  <Text style={[styles.menuItemDesc, { color: colors.mutedForeground }]}>
                    Browse past quality checks and outcomes
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </Pressable>
            )}
            {isManager && (
              <Pressable
                onPress={() => {
                  setMenuOpen(false);
                  router.push("/roles" as never);
                }}
                style={({ pressed }) => [
                  styles.menuItem,
                  {
                    backgroundColor: colors.secondary,
                    borderColor: colors.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <View style={[styles.menuIcon, { backgroundColor: colors.primary + "22" }]}>
                  <Feather name="shield" size={18} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.menuItemLabel, { color: colors.foreground }]}>
                    Roles
                  </Text>
                  <Text style={[styles.menuItemDesc, { color: colors.mutedForeground }]}>
                    Create roles, set capabilities, and assign staff
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </Pressable>
            )}
            {me?.sandbox && (
              <Pressable
                onPress={() => {
                  setMenuOpen(false);
                  doSandboxReset();
                }}
                style={({ pressed }) => [
                  styles.menuItem,
                  {
                    backgroundColor: colors.secondary,
                    borderColor: colors.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <View
                  style={[
                    styles.menuIcon,
                    { backgroundColor: (colors.warning ?? colors.primary) + "22" },
                  ]}
                >
                  <Feather
                    name="rotate-ccw"
                    size={18}
                    color={colors.warning ?? colors.primary}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.menuItemLabel, { color: colors.foreground }]}>
                    Reset sandbox
                  </Text>
                  <Text style={[styles.menuItemDesc, { color: colors.mutedForeground }]}>
                    Replace sandbox data with a fresh copy of live
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </Pressable>
            )}
            <Pressable
              onPress={() => {
                setMenuOpen(false);
                void signOut();
              }}
              style={({ pressed }) => [
                styles.menuItem,
                {
                  backgroundColor: colors.secondary,
                  borderColor: colors.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <View style={[styles.menuIcon, { backgroundColor: colors.destructive + "22" }]}>
                <Feather name="log-out" size={18} color={colors.destructive} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.menuItemLabel, { color: colors.foreground }]}>
                  Sign out
                </Text>
                <Text style={[styles.menuItemDesc, { color: colors.mutedForeground }]}>
                  End your session on this device
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <ReportIssueModal
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        screen="mobile"
      />

      <GetStartedModal
        visible={getStartedOpen}
        isManager={isManager}
        onStartTour={() => setTourOpen(true)}
        onDismiss={closeGetStarted}
      />

      <GuidedTour
        visible={tourOpen}
        isManager={isManager}
        onClose={() => setTourOpen(false)}
        onComplete={() => void markTourCompleted()}
        onNavigate={(route) => router.push(route as never)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  menuBtn: { paddingHorizontal: 16, paddingVertical: 4 },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    gap: 10,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 12,
  },
  sheetTitle: {
    fontSize: 18,
    fontFamily: FONTS.bold,
    marginBottom: 6,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  menuIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  menuItemLabel: { fontSize: 16, fontFamily: FONTS.semibold },
  menuItemDesc: { fontSize: 12, marginTop: 2, fontFamily: FONTS.regular },
  headerBadge: {
    position: "absolute",
    top: -2,
    right: 8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    paddingHorizontal: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  headerBadgeText: {
    color: "#fff",
    fontSize: 9,
    fontFamily: FONTS.bold,
    lineHeight: 12,
  },
  menuBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  menuBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontFamily: FONTS.bold,
    lineHeight: 14,
  },
});
