import type { RunProfile } from "@/context/RunContext";

// Factory spec-sheet seed data intentionally EMPTIED (2026-07-03 full data
// purge): the app ships with no built-in brands/profiles/recipes; the user
// imports their own spec sheets. Mirror of the web specSeed.ts. Export shapes
// kept so consumers still compile.
export const SPEC_BRANDS: string[] = [];

export const SPEC_BRAND_FLAVORS: Record<string, string[]> = {};

export const SPEC_PEP_TYPES: string[] = [];

export const SPEC_CHEESE_INGREDIENTS: string[] = [];

export const SPEC_PROFILES: Record<string, RunProfile> = {};

export const DOUGH_RECIPES: Record<string, { ingredient: string; lbs: number }[]> = {};

export const DOUGH_BRAND_SPECS: { brand: string; flavor?: string; recipe: string; oz: number }[] = [];

export const SAUCE_RECIPES: Record<string, { ingredient: string; lbs: number }[]> = {};

export const SAUCE_BRAND_SPECS: { brand: string; flavor?: string; recipe: string }[] = [];

export const CHEESE_RECIPES: Record<string, { ingredient: string; lbs: number }[]> = {};

export const CHEESE_BRAND_SPECS: { brand: string; flavor?: string; app: number; recipe: string }[] = [];

export const SPEC_DIE_TYPES: Record<string, string> = {};
