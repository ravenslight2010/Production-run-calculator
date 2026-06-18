import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchStaff, setStaffRole, type Role, type StaffMember } from "../inventoryShared";
import { useMe } from "../useRole";

// Manager-only UI for viewing every signed-in staff member and changing their
// role. The server enforces a last-manager guard, so the failure is surfaced
// inline if a manager tries to demote the only remaining manager.
export default function StaffRolesCard() {
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
    <Card className="bg-card/50 border-border/50 shadow-md">
      <CardHeader className="pb-2 pt-4 px-5">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Users className="w-4 h-4" /> Staff &amp; Roles
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        {isLoading && (
          <p className="text-xs text-muted-foreground italic flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading staff…
          </p>
        )}
        {error && (
          <p className="text-xs text-red-500">Could not load staff list.</p>
        )}
        {mutation.isError && (
          <p className="text-xs text-red-500">
            {mutation.error instanceof Error
              ? mutation.error.message
              : "Could not update role."}
          </p>
        )}
        {!isLoading && staff.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No staff yet. Members appear here after they sign in.
          </p>
        )}
        {staff.map((member) => {
          const isSelf = me?.userId === member.userId;
          return (
            <div
              key={member.userId}
              className="flex items-center justify-between gap-3 rounded-md border border-border/40 bg-muted/10 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {member.name || member.email || member.userId}
                  {isSelf && (
                    <span className="ml-1.5 text-[10px] font-bold uppercase text-muted-foreground">
                      (you)
                    </span>
                  )}
                </p>
                {member.email && member.name && (
                  <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                )}
              </div>
              <select
                className="h-8 rounded-md border border-border/60 bg-background px-2 text-xs font-semibold text-foreground disabled:opacity-50"
                value={member.role}
                disabled={mutation.isPending}
                onChange={(e) =>
                  mutation.mutate({
                    userId: member.userId,
                    role: e.target.value as Role,
                  })
                }
              >
                <option value="manager">Manager</option>
                <option value="operator">Operator</option>
              </select>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
