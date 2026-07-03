import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { KeyRound, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useAuth } from "../useAuth";
import { InventoryApiError } from "../inventoryShared";

const MIN_PASSWORD_LENGTH = 6;

// Account self-service: lets any signed-in user change their own password.
// Verifies the current password server-side before replacing the stored hash.
export default function ChangePasswordCard() {
  const { changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: () => changePassword(currentPassword, newPassword),
    onSuccess: () => {
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
  });

  const serverError = mutation.isError
    ? mutation.error instanceof InventoryApiError &&
      mutation.error.serverMessage
      ? mutation.error.serverMessage
      : "Could not change password. Please try again."
    : null;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setClientError(null);
    setSuccess(false);
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setClientError(
        `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      setClientError("New passwords do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setClientError("New password must be different from the current one.");
      return;
    }
    mutation.mutate();
  };

  return (
    <Card className="bg-card/50 border-border/50 shadow-md">
      <CardHeader className="pb-2 pt-4 px-5">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <KeyRound className="w-4 h-4" /> Change Password
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="current-password" className="text-xs">
              Current password
            </Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password" className="text-xs">
              New password
            </Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-password" className="text-xs">
              Confirm new password
            </Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          {clientError && (
            <p className="text-xs text-red-500">{clientError}</p>
          )}
          {serverError && <p className="text-xs text-red-500">{serverError}</p>}
          {success && (
            <p className="text-xs text-green-600">Password updated.</p>
          )}
          <Button
            type="submit"
            size="sm"
            disabled={
              mutation.isPending ||
              !currentPassword ||
              !newPassword ||
              !confirmPassword
            }
            className="w-full"
          >
            {mutation.isPending && (
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
            )}
            Update password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
