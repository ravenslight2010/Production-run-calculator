import { createHash } from "node:crypto";
import {
  APP_KNOWLEDGE_VERSION,
  appKnowledgeSha256,
  renderAppKnowledgeContext,
  retrieveAppKnowledge,
} from "./appKnowledge.js";

export const LOCAL_EVALUATION_MODEL = "qwen3.5-9b-q3_k_m";
export const LOCAL_EVALUATION_ENDPOINT = "http://127.0.0.1:11434/v1/chat/completions";
export const LOCAL_EVALUATION_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_TOKENS = 256;
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_MESSAGES_CHARS = 64_000;
const MAX_SOURCE_TEXT_CHARS = 32_000;
const MAX_SYSTEM_PROMPT_CHARS = 16_000;
const MAX_IMAGES = 8;

type CandidateBase = {
  fixtureId: string;
  systemPrompt: string;
  knowledgeQuery: string;
  maxOutputTokens: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type WorkbookCellEvidence = {
  sheet: string;
  cell: string;
  textValue: string | null;
  formulaText: string | null;
  cachedValueText: string | null;
};

export type LocalCandidateRequest =
  | (CandidateBase & {
      route: "workbook-text";
      sourceText: string;
      sourceCells: WorkbookCellEvidence[];
    })
  | (CandidateBase & {
      route: "spec-images";
      instruction: string;
      pageImages: string[];
    })
  | (CandidateBase & {
      route: "unresolved-resolution";
      deterministicPassComplete: true;
      unresolvedCandidates: string[];
      allowedTargets: string[];
    });

export type LocalCandidateResult = {
  fixtureId: string;
  route: LocalCandidateRequest["route"];
  model: typeof LOCAL_EVALUATION_MODEL;
  knowledgeVersion: typeof APP_KNOWLEDGE_VERSION;
  knowledgeSha256: string;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  content: string;
};

export type LocalCandidateErrorCode =
  | "invalid_request"
  | "busy"
  | "cancelled"
  | "timeout"
  | "unavailable"
  | "invalid_response";

export class LocalCandidateError extends Error {
  constructor(
    readonly code: LocalCandidateErrorCode,
    readonly status?: number,
  ) {
    super(`Local evaluation candidate ${code.replaceAll("_", " ")}.`);
    this.name = "LocalCandidateError";
  }
}

export type ResolutionSuggestion = {
  source: string;
  target: string;
};

let requestActive = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertText(value: unknown, maxLength: number): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new LocalCandidateError("invalid_request");
  }
}

function validateBase(request: CandidateBase): number {
  if (!/^synthetic:[A-Za-z0-9_-]{1,64}$/.test(request.fixtureId)) {
    throw new LocalCandidateError("invalid_request");
  }
  assertText(request.systemPrompt, MAX_SYSTEM_PROMPT_CHARS);
  assertText(request.knowledgeQuery, 512);
  if (
    !Number.isInteger(request.maxOutputTokens)
    || request.maxOutputTokens < 1
    || request.maxOutputTokens > MAX_OUTPUT_TOKENS
  ) {
    throw new LocalCandidateError("invalid_request");
  }
  const timeout = request.timeoutMs ?? LOCAL_EVALUATION_TIMEOUT_MS;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > LOCAL_EVALUATION_TIMEOUT_MS) {
    throw new LocalCandidateError("invalid_request");
  }
  if (request.signal?.aborted) throw new LocalCandidateError("cancelled");
  return timeout;
}

function validateInlineImage(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= MAX_REQUEST_BYTES
    && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function isWorkbookCellAddress(value: string): boolean {
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(value);
  if (!match || Number(match[2]) > 1_048_576) return false;
  let column = 0;
  for (const letter of match[1]!) {
    column = column * 26 + letter.charCodeAt(0) - 64;
  }
  return column <= 16_384;
}

function validateWorkbookCells(value: unknown): asserts value is WorkbookCellEvidence[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 512) {
    throw new LocalCandidateError("invalid_request");
  }
  const seen = new Set<string>();
  for (const cell of value) {
    if (
      !isRecord(cell)
      || Object.keys(cell).length !== 5
      || Object.keys(cell).some((key) =>
        !["sheet", "cell", "textValue", "formulaText", "cachedValueText"].includes(key)
      )
      || typeof cell.sheet !== "string"
      || !cell.sheet.trim()
      || cell.sheet.trim() !== cell.sheet
      || cell.sheet.length > 128
      || typeof cell.cell !== "string"
      || !isWorkbookCellAddress(cell.cell)
      || ![cell.textValue, cell.formulaText, cell.cachedValueText].every(
        (field) => field === null || (typeof field === "string" && field.length <= 4_000),
      )
      || (cell.textValue === null && cell.formulaText === null && cell.cachedValueText === null)
    ) {
      throw new LocalCandidateError("invalid_request");
    }
    const identity = `${cell.sheet}\u0000${cell.cell}`;
    if (seen.has(identity)) throw new LocalCandidateError("invalid_request");
    seen.add(identity);
  }
}

function buildMessages(request: LocalCandidateRequest) {
  const scopedKnowledge = retrieveAppKnowledge(
    request.knowledgeQuery,
    request.route,
    "evaluator",
  );
  const system = [
    request.systemPrompt,
    renderAppKnowledgeContext(scopedKnowledge),
  ].join("\n\n");

  if (request.route === "workbook-text") {
    assertText(request.sourceText, MAX_SOURCE_TEXT_CHARS);
    validateWorkbookCells(request.sourceCells);
    return [
      { role: "system", content: system },
      {
        role: "user",
        content: JSON.stringify({
          sourceText: request.sourceText,
          sourceCells: request.sourceCells,
        }),
      },
    ];
  }

  if (request.route === "spec-images") {
    assertText(request.instruction, 4_000);
    if (
      !Array.isArray(request.pageImages)
      || request.pageImages.length < 1
      || request.pageImages.length > MAX_IMAGES
      || request.pageImages.some((image) => !validateInlineImage(image))
    ) {
      throw new LocalCandidateError("invalid_request");
    }
    return [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: request.instruction },
          ...request.pageImages.map((url) => ({
            type: "image_url",
            image_url: { url },
          })),
        ],
      },
    ];
  }

  if (request.deterministicPassComplete !== true) {
    throw new LocalCandidateError("invalid_request");
  }
  const unresolved = request.unresolvedCandidates;
  const targets = request.allowedTargets;
  if (
    !Array.isArray(unresolved)
    || unresolved.length < 1
    || unresolved.length > 50
    || !Array.isArray(targets)
    || targets.length < 1
    || targets.length > 100
    || unresolved.some((item) => typeof item !== "string" || !item.trim() || item.length > 160)
    || targets.some((item) => typeof item !== "string" || !item.trim() || item.length > 160)
    || new Set(unresolved).size !== unresolved.length
    || new Set(targets).size !== targets.length
  ) {
    throw new LocalCandidateError("invalid_request");
  }
  return [
    {
      role: "system",
      content: [
        system,
        "Suggest matches only for the supplied unresolved names.",
        "Targets must be exact members of the supplied allowlist.",
        "Return JSON with exactly one key, suggestions, whose value is an array of source/target objects.",
        "Suggestions are advisory and do not write or authorize any change.",
      ].join("\n\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        unresolvedCandidates: unresolved,
        allowedTargets: targets,
      }),
    },
  ];
}

async function readBoundedBody(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new LocalCandidateError("invalid_response");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new LocalCandidateError("invalid_response");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

function parseUsage(value: unknown): { promptTokens: number | null; completionTokens: number | null } {
  if (!isRecord(value)) return { promptTokens: null, completionTokens: null };
  const prompt = value.prompt_tokens;
  const completion = value.completion_tokens;
  return {
    promptTokens: Number.isSafeInteger(prompt) && (prompt as number) >= 0 ? prompt as number : null,
    completionTokens: Number.isSafeInteger(completion) && (completion as number) >= 0
      ? completion as number
      : null,
  };
}

export async function runLocalEvaluationCandidate(
  request: LocalCandidateRequest,
): Promise<LocalCandidateResult> {
  const timeoutMs = validateBase(request);
  if (requestActive) throw new LocalCandidateError("busy");
  const messages = buildMessages(request);
  const payload = JSON.stringify({
    model: LOCAL_EVALUATION_MODEL,
    messages,
    response_format: { type: "json_object" },
    max_tokens: request.maxOutputTokens,
    temperature: 0,
    stream: false,
  });
  const bodyBytes = Buffer.byteLength(payload, "utf8");
  if (bodyBytes > MAX_REQUEST_BYTES || JSON.stringify(messages).length > MAX_MESSAGES_CHARS) {
    throw new LocalCandidateError("invalid_request");
  }

  requestActive = true;
  const controller = new AbortController();
  const onAbort = () => controller.abort("cancelled");
  request.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetch(LOCAL_EVALUATION_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 408 || response.status === 504) {
        throw new LocalCandidateError("timeout", response.status);
      }
      if ([429, 502, 503].includes(response.status)) {
        throw new LocalCandidateError("unavailable", response.status);
      }
      throw new LocalCandidateError("invalid_response", response.status);
    }
    let result: unknown;
    try {
      result = JSON.parse(await readBoundedBody(response));
    } catch (error) {
      if (error instanceof LocalCandidateError) throw error;
      throw new LocalCandidateError("invalid_response");
    }
    if (!isRecord(result) || result.model !== LOCAL_EVALUATION_MODEL) {
      throw new LocalCandidateError("invalid_response");
    }
    const choices = result.choices;
    if (!Array.isArray(choices) || !isRecord(choices[0])) {
      throw new LocalCandidateError("invalid_response");
    }
    const message = choices[0].message;
    if (!isRecord(message) || typeof message.content !== "string") {
      throw new LocalCandidateError("invalid_response");
    }
    const usage = parseUsage(result.usage);
    return {
      fixtureId: request.fixtureId,
      route: request.route,
      model: LOCAL_EVALUATION_MODEL,
      knowledgeVersion: APP_KNOWLEDGE_VERSION,
      knowledgeSha256: appKnowledgeSha256(),
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      content: message.content,
    };
  } catch (error) {
    if (error instanceof LocalCandidateError) throw error;
    if (request.signal?.aborted || controller.signal.reason === "cancelled") {
      throw new LocalCandidateError("cancelled");
    }
    if (controller.signal.aborted || controller.signal.reason === "timeout") {
      throw new LocalCandidateError("timeout");
    }
    throw new LocalCandidateError("unavailable");
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", onAbort);
    requestActive = false;
  }
}

export function parseResolutionSuggestions(
  content: string,
  unresolvedCandidates: readonly string[],
  allowedTargets: readonly string[],
): ResolutionSuggestion[] {
  if (
    typeof content !== "string"
    || content.length > MAX_RESPONSE_BYTES
    || unresolvedCandidates.length > 50
    || allowedTargets.length > 100
  ) {
    throw new LocalCandidateError("invalid_response");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(content);
  } catch {
    throw new LocalCandidateError("invalid_response");
  }
  if (!isRecord(decoded) || Object.keys(decoded).length !== 1 || !Array.isArray(decoded.suggestions)) {
    throw new LocalCandidateError("invalid_response");
  }
  const unresolved = new Set(unresolvedCandidates);
  const targets = new Set(allowedTargets);
  if (decoded.suggestions.length > unresolved.size) {
    throw new LocalCandidateError("invalid_response");
  }
  const seen = new Set<string>();
  const suggestions: ResolutionSuggestion[] = [];
  for (const item of decoded.suggestions) {
    if (
      !isRecord(item)
      || Object.keys(item).length !== 2
      || typeof item.source !== "string"
      || typeof item.target !== "string"
      || !unresolved.has(item.source)
      || !targets.has(item.target)
      || seen.has(item.source)
      || item.source === item.target
    ) {
      throw new LocalCandidateError("invalid_response");
    }
    seen.add(item.source);
    suggestions.push({ source: item.source, target: item.target });
  }
  return suggestions;
}

export function localCandidateRequestFingerprint(request: LocalCandidateRequest): string {
  let input: unknown;
  if (request.route === "workbook-text") {
    input = { sourceText: request.sourceText, sourceCells: request.sourceCells };
  } else if (request.route === "spec-images") {
    input = {
      instruction: request.instruction,
      pageImages: request.pageImages.map((image) =>
        createHash("sha256").update(image).digest("hex")
      ),
    };
  } else {
    input = {
      deterministicPassComplete: request.deterministicPassComplete,
      unresolvedCandidates: request.unresolvedCandidates,
      allowedTargets: request.allowedTargets,
    };
  }
  const identity = JSON.stringify({
    route: request.route,
    fixtureId: request.fixtureId,
    model: LOCAL_EVALUATION_MODEL,
    knowledgeVersion: APP_KNOWLEDGE_VERSION,
    knowledgeSha256: appKnowledgeSha256(),
    promptSha256: createHash("sha256").update(request.systemPrompt).digest("hex"),
    query: request.knowledgeQuery,
    maxOutputTokens: request.maxOutputTokens,
    input,
  });
  return createHash("sha256").update(identity).digest("hex");
}
