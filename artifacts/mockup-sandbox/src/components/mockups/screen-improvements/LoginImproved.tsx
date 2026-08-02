import React from "react";

export function LoginImproved() {
  return (
    <div className="dark flex min-h-screen flex-col items-center justify-center bg-background text-foreground px-6 py-12 text-center">
      {/* Logo block */}
      <div className="mx-auto mb-6 h-20 w-20 rounded-2xl bg-card shadow-lg flex items-center justify-center ring-1 ring-amber-500/20">
        <span className="text-4xl">🍕</span>
      </div>
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Production Run Calculator</h1>
      <p className="mt-3 text-base text-muted-foreground max-w-xs">
        Pizza production line planning, scheduling, and inventory — for floor staff. Sign in to get started.
      </p>

      {/* Card */}
      <div className="mt-6 w-full max-w-sm overflow-hidden rounded-2xl border-x border-b border-border/50 border-t-2 border-t-amber-500/40 bg-card/70 shadow-md">
        <div className="flex flex-col gap-3 p-6">
          <button className="w-full rounded-lg bg-amber-500 px-4 py-3 text-sm font-semibold text-black transition-colors hover:bg-amber-400">
            Sign in
          </button>
          <button className="w-full rounded-lg border border-amber-500/30 bg-transparent px-4 py-3 text-sm font-semibold text-amber-400 transition-colors hover:bg-amber-500/10">
            Create staff account
          </button>
        </div>
      </div>

      <p className="mt-8 text-xs text-muted-foreground">Access is limited to authorized staff.</p>
    </div>
  );
}
