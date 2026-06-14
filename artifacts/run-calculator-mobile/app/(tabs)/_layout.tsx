import { BlurView } from "expo-blur";
import { Tabs, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

const MENU_ITEMS: {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  route: string;
  desc: string;
}[] = [
  { label: "Stoppages", icon: "clock", route: "/stoppages", desc: "Log and review downtime" },
  { label: "Summary", icon: "list", route: "/summary", desc: "Shift totals and export" },
  { label: "Setup", icon: "sliders", route: "/configure", desc: "Run config and recipes" },
  { label: "Settings", icon: "settings", route: "/settings", desc: "App options and master data" },
];

export default function TabLayout() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const [menuOpen, setMenuOpen] = useState(false);

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
            >
              <Feather name="menu" size={22} color={colors.foreground} />
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
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </Pressable>
            ))}
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
    fontWeight: "700" as const,
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
  menuItemLabel: { fontSize: 16, fontWeight: "600" as const },
  menuItemDesc: { fontSize: 12, marginTop: 2 },
});
