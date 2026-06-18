import { useAuth } from "@/context/auth";
import { BlurView } from "expo-blur";
import { Redirect, Tabs, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { FONTS } from "@/constants/fonts";
import { usePendingResetCount } from "@/hooks/usePendingResetCount";

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
  const { signOut, isLoading, isAuthenticated } = useAuth();
  const insets = useSafeAreaInsets();
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const [menuOpen, setMenuOpen] = useState(false);
  // Manager-only nav badge: pending password reset requests awaiting approval.
  const pendingResetCount = usePendingResetCount();

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
                pendingResetCount > 0
                  ? `Menu, ${pendingResetCount} password reset requests waiting`
                  : "Menu"
              }
            >
              <Feather name="menu" size={22} color={colors.foreground} />
              {pendingResetCount > 0 && (
                <View
                  style={[
                    styles.headerBadge,
                    {
                      backgroundColor: colors.warning ?? colors.primary,
                      borderColor: colors.background,
                    },
                  ]}
                >
                  <Text style={styles.headerBadgeText}>{pendingResetCount}</Text>
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
        <Tabs.Screen name="stoppages" options={{ href: null, title: "Stoppages" }} />
        <Tabs.Screen name="summary" options={{ href: null, title: "Summary" }} />
        <Tabs.Screen name="configure" options={{ href: null, title: "Setup" }} />
        <Tabs.Screen name="settings" options={{ href: null, title: "Settings" }} />
      </Tabs>

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
