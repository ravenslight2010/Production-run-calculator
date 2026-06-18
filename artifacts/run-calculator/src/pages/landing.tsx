import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";

export default function Landing() {
  const [, setLocation] = useLocation();
  const logoUrl = `${import.meta.env.BASE_URL}logo.svg`;

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-6 py-12 text-center">
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

        <div className="mt-8 flex flex-col gap-3">
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
            className="w-full"
            onClick={() => setLocation("/sign-up")}
          >
            Create staff account
          </Button>
        </div>

        <p className="mt-8 text-xs text-muted-foreground">
          Access is limited to authorized staff.
        </p>
      </div>
    </div>
  );
}
