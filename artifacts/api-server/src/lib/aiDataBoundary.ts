export type AiRouteBoundary = {
  path: string;
  capability: "use-ai-tools" | "manage-inventory";
  purpose: string;
  provider: "Google Gemini via Replit AI integration";
  dataCategories: readonly string[];
  topLevelFields: readonly string[];
  maxRequestBytes: number;
  retention: string;
  fallback: string;
};

export const AI_ROUTE_BOUNDARIES = {
  matchImport: {
    path: "/ai/match-import",
    capability: "use-ai-tools",
    purpose: "Suggest canonical names for unresolved import labels.",
    provider: "Google Gemini via Replit AI integration",
    dataCategories: ["unresolved import names", "bounded canonical-name candidates", "confirmed name corrections"],
    topLevelFields: [
      "brands", "brandFlavors", "unmatchedBrands", "unmatchedFlavors", "knownIngredients",
      "unmatchedIngredients", "knownAppTypes", "unmatchedAppTypes", "knownPepTypes",
      "unmatchedPepTypes",
    ],
    maxRequestBytes: 512_000,
    retention: "Sanitized suggestions may be cached for 15 minutes; raw prompts and provider payloads are not retained.",
    fallback: "Deterministic matches remain available when AI is unavailable.",
  },
  parseSpecSheet: {
    path: "/ai/parse-spec-sheet",
    capability: "use-ai-tools",
    purpose: "Extract reviewable profiles and recipes from selected workbook text.",
    provider: "Google Gemini via Replit AI integration",
    dataCategories: ["selected workbook text", "bounded canonical-name candidates", "confirmed name corrections"],
    topLevelFields: ["workbookText", "known", "aliases"],
    maxRequestBytes: 1_000_000,
    retention: "Raw prompts and provider payloads are not retained; a user must review results before import.",
    fallback: "Deterministic workbook handling and core production remain available without AI.",
  },
  workbookParseJob: {
    path: "/server-jobs (type: workbook-parse)",
    capability: "use-ai-tools",
    purpose: "Parse selected workbook text asynchronously into reviewable profiles and recipes.",
    provider: "Google Gemini via Replit AI integration",
    dataCategories: ["selected workbook text", "bounded canonical-name candidates", "confirmed name corrections"],
    topLevelFields: ["workbookText", "known", "aliases"],
    maxRequestBytes: 512_000,
    retention: "Queued source and sanitized result follow the seven-day job lifecycle; raw prompts and provider payloads are not retained.",
    fallback: "Deterministic workbook handling and core production remain available without AI.",
  },
  parseSpecImages: {
    path: "/ai/parse-spec-images",
    capability: "use-ai-tools",
    purpose: "Transcribe selected spec-sheet photos for review.",
    provider: "Google Gemini via Replit AI integration",
    dataCategories: ["selected spec-sheet images"],
    topLevelFields: ["images"],
    maxRequestBytes: 10_000_000,
    retention: "Images and raw provider payloads are not retained; a user must review results before import.",
    fallback: "Manual workbook import remains available without AI.",
  },
  matchPremix: {
    path: "/ai/match-premix",
    capability: "use-ai-tools",
    purpose: "Suggest saved products for unresolved premix names.",
    provider: "Google Gemini via Replit AI integration",
    dataCategories: ["unresolved premix names", "bounded brand and flavor candidates", "confirmed name corrections"],
    topLevelFields: ["brands", "brandFlavors", "unmatchedNames"],
    maxRequestBytes: 256_000,
    retention: "Sanitized suggestions may be cached for 15 minutes; raw prompts and provider payloads are not retained.",
    fallback: "Deterministic matches remain available when AI is unavailable.",
  },
  identifyInventoryPhoto: {
    path: "/inventory/identify-photo",
    capability: "use-ai-tools",
    purpose: "Suggest inventory items visible in a selected stock photo.",
    provider: "Google Gemini via Replit AI integration",
    dataCategories: ["selected stock photo", "bounded inventory-item candidates"],
    topLevelFields: ["imageBase64", "mimeType", "candidates"],
    maxRequestBytes: 9_000_000,
    retention: "The photo and raw provider payload are not retained; suggestions are advisory.",
    fallback: "Typed and barcode inventory controls remain available without AI.",
  },
  productionSheetPhoto: {
    path: "/inventory/production-sheet-photo",
    capability: "use-ai-tools",
    purpose: "Transcribe run rows from a selected production-sheet photo.",
    provider: "Google Gemini via Replit AI integration",
    dataCategories: ["selected production-sheet photo", "optional bounded transcription notes"],
    topLevelFields: ["imageBase64", "mimeType", "notes"],
    maxRequestBytes: 9_000_000,
    retention: "The photo and raw provider payload are not retained; every row requires review.",
    fallback: "Manual schedule entry remains available without AI.",
  },
  inventoryCountObservation: {
    path: "/inventory/count-observations",
    capability: "manage-inventory",
    purpose: "Create a reviewable count draft from selected inventory photos.",
    provider: "Google Gemini via Replit AI integration",
    dataCategories: ["one to three selected inventory photos", "bounded inventory-item candidates"],
    topLevelFields: ["photos", "candidates"],
    maxRequestBytes: 10_000_000,
    retention: "Only sanitized draft results and photo metadata are retained; image bytes and raw provider payloads are not.",
    fallback: "The main application keeps this route disabled; typed inventory controls remain available.",
  },
} as const satisfies Record<string, AiRouteBoundary>;

const PROHIBITED_KEY =
  /^(authorization|cookie|cookies|credential|credentials|password|passwd|secret|secrets|token|tokens|access[-_]?token|refresh[-_]?token|auth[-_]?token|api[-_]?key|session|sessionid|log|logs|stack|stacktrace)$/i;

function findProhibitedKey(value: unknown, path = "$", seen = new Set<object>()): string | null {
  if (!value || typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const found = findProhibitedKey(value[index], `${path}[${index}]`, seen);
      if (found) return found;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (PROHIBITED_KEY.test(key)) return `${path}.${key}`;
    const found = findProhibitedKey(child, `${path}.${key}`, seen);
    if (found) return found;
  }
  return null;
}

function jsonByteLength(value: unknown): number | null {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return null;
  }
}

export function validateAiRequestBoundary(
  boundary: AiRouteBoundary,
  body: unknown,
): { ok: true } | { ok: false; status: 400 | 413; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Invalid AI request body" };
  }
  const prohibited = findProhibitedKey(body);
  if (prohibited) {
    return { ok: false, status: 400, error: "Sensitive or unrelated fields are not allowed in AI requests" };
  }
  const allowed = new Set(boundary.topLevelFields);
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  if (unknown) {
    return { ok: false, status: 400, error: `Field "${unknown}" is not allowed for this AI operation` };
  }
  const bytes = jsonByteLength(body);
  if (bytes === null) {
    return { ok: false, status: 400, error: "Invalid AI request body" };
  }
  if (bytes > boundary.maxRequestBytes) {
    return { ok: false, status: 413, error: "AI request payload is too large" };
  }
  return { ok: true };
}

export function safeAiErrorMetadata(err: unknown): {
  status?: string | number;
  code?: string | number;
  errorType: string;
} {
  if (!err || typeof err !== "object") return { errorType: typeof err };
  const value = err as { status?: unknown; code?: unknown; name?: unknown };
  return {
    ...(typeof value.status === "string" || typeof value.status === "number"
      ? { status: value.status }
      : {}),
    ...(typeof value.code === "string" || typeof value.code === "number"
      ? { code: value.code }
      : {}),
    errorType: typeof value.name === "string" ? value.name.slice(0, 80) : "Error",
  };
}
