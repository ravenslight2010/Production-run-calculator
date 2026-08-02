import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";

export default function Landing() {
  const [, setLocation] = useLocation();
  const logoUrl = `${import.meta.env.BASE_URL}logo.svg`;

  return (
    <div className="dark flex min-h-[100dvh] flex-col items-center justify-center bg-background text-foreground px-6 py-12 text-center">
      <div className="w-full max-w-md">
        <img
          src={logoUrl}
          alt="Run Calculator"
          className="mx-auto mb-6 h-20 w-20 rounded-2xl shadow-lg"
        />
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Production Run Calculator
        </h1>
        <p className="mt-3 text-base text-muted-foreground">
          Pizza production line planning, scheduling, and inventory — for floor
          staff. Sign in to get started.
        </p>

        <div className="mt-8 overflow-hidden rounded-2xl border border-border/50 bg-card/60 shadow-md">
          <div className="h-1 w-full bg-gradient-to-r from-amber-600 via-amber-500 to-amber-400" />
          <div className="flex flex-col gap-3 p-6">
            <Button
              size="lg"
              className="w-full"
              onClick={() => setLocation("/sign-in")}
            >
              Sign in
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="w-full border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 hover:border-amber-500/50"
              onClick={() => setLocation("/sign-up")}
            >
              Create staff account
            </Button>
          </div>
        </div>

        <p className="mt-8 text-xs text-muted-foreground">
          Access is limited to authorized staff.
        </p>
      </div>
    </div>
  );
}
