import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/UI";
import { useColors } from "@/hooks/useColors";
import { FONTS } from "@/constants/fonts";
import { fetchStaff, setStaffRole, type Role, type StaffMember } from "@/context/inventoryShared";
import { useMe } from "@/hooks/useRole";

// Manager-only UI for viewing every signed-in staff member and changing their
// role. The server enforces a last-manager guard, so a failed demotion of the
// only remaining manager is surfaced inline.
export default function StaffRolesCard() {
  const colors = useColors();
  const qc = useQueryClient();
  const { me } = useMe();
  const { data, isLoading, error } = useQuery({
    queryKey: ["staff"],
    queryFn: fetchStaff,
  });

  const mutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      setStaffRole(userId, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });

  const staff: StaffMember[] = data ?? [];

  return (
    <Card title="Staff & Roles" icon="users" style={{ marginBottom: 16 }}>
      {isLoading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.mutedForeground} />
          <Text style={[styles.muted, { color: colors.mutedForeground }]}>Loading staff…</Text>
        </View>
      )}
      {error && (
        <Text style={[styles.muted, { color: colors.destructive }]}>Could not load staff list.</Text>
      )}
      {mutation.isError && (
        <Text style={[styles.muted, { color: colors.destructive }]}>
          {mutation.error instanceof Error ? mutation.error.message : "Could not update role."}
        </Text>
      )}
      {!isLoading && staff.length === 0 && (
        <Text style={[styles.empty, { color: colors.mutedForeground }]}>
          No staff yet. Members appear here after they sign in.
        </Text>
      )}
      <View style={{ gap: 8 }}>
        {staff.map((member) => {
          const isSelf = me?.userId === member.userId;
          return (
            <View
              key={member.userId}
              style={[styles.row, { borderColor: colors.border, backgroundColor: colors.background }]}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
                  {member.name || member.email || member.userId}
                  {isSelf ? "  (you)" : ""}
                </Text>
                {member.email && member.name ? (
                  <Text style={[styles.sub, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {member.email}
                  </Text>
                ) : null}
              </View>
              <View style={styles.toggle}>
                {(["manager", "operator"] as Role[]).map((r) => {
                  const active = member.role === r;
                  return (
                    <Pressable
                      key={r}
                      disabled={mutation.isPending || active}
                      onPress={() => mutation.mutate({ userId: member.userId, role: r })}
                      style={[
                        styles.toggleBtn,
                        {
                          backgroundColor: active ? colors.primary : "transparent",
                          borderColor: colors.border,
                          opacity: mutation.isPending ? 0.5 : 1,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.toggleText,
                          { color: active ? colors.primaryForeground : colors.mutedForeground },
                        ]}
                      >
                        {r === "manager" ? "Manager" : "Operator"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  muted: { fontSize: 12, fontFamily: FONTS.regular },
  empty: { fontSize: 13, fontFamily: FONTS.regular, textAlign: "center", paddingVertical: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  name: { fontSize: 14, fontFamily: FONTS.medium },
  sub: { fontSize: 12, fontFamily: FONTS.regular },
  toggle: { flexDirection: "row", gap: 4 },
  toggleBtn: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  toggleText: { fontSize: 11, fontFamily: FONTS.medium },
});
