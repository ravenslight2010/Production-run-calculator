import {
  enrichedSuggestionMetadata,
  runBoundedJsonModel,
  unavailableSuggestionMetadata,
  type AiModelLogger,
  type AiStatusMetadata,
} from "./aiBoundedJson";

export const MAX_REVIEWED_WORKBOOK_TEXT_CHARS = 60_000;
export const MAX_REVIEWED_SPEC_IMAGES = 10;
export const MAX_REVIEWED_SPEC_IMAGE_BASE64_CHARS = 7_000_000;

export type GroundedDocumentPrompt = {
  system: string;
  /**
   * The caller supplies already-grounded text. This service intentionally does
   * not read corrections or facility memory, preserving that ownership at the
   * route boundary.
   */
  user: string;
};

export type WorkbookTextDocument = {
  kind: "workbook-text";
  workbookText: string;
};

export type SpecImageDocument = {
  mimeType: string;
  imageBase64: string;
};

export type SpecImagesDocument = {
  kind: "spec-images";
  images: readonly SpecImageDocument[];
};

export type ReviewedDocumentSource = WorkbookTextDocument | SpecImagesDocument;

export type ReviewedDocumentModelInput = {
  prompt: GroundedDocumentPrompt;
  source: ReviewedDocumentSource;
};

export type DocumentSourceAdapter<TSource extends ReviewedDocumentSource> = {
  kind: TSource["kind"];
  validate: (source: TSource) => string | null;
  toModelInput: (prompt: GroundedDocumentPrompt, source: TSource) => ReviewedDocumentModelInput;
};

/** Adapter contract for workbook parsing handlers. */
export const workbookTextAdapter: DocumentSourceAdapter<WorkbookTextDocument> = {
  kind: "workbook-text",
  validate(source) {
    const text = source.workbookText.trim();
    if (!text) return "Workbook text is empty";
    if (text.length > MAX_REVIEWED_WORKBOOK_TEXT_CHARS) {
      return `Workbook text exceeds ${MAX_REVIEWED_WORKBOOK_TEXT_CHARS} characters`;
    }
    return null;
  },
  toModelInput(prompt, source) {
    return { prompt, source: { kind: "workbook-text", workbookText: source.workbookText.trim() } };
  },
};

/** Adapter contract for vision-to-workbook transcription handlers. */
export const specImagesAdapter: DocumentSourceAdapter<SpecImagesDocument> = {
  kind: "spec-images",
  validate(source) {
    if (!source.images.length) return "No spec images supplied";
    if (source.images.length > MAX_REVIEWED_SPEC_IMAGES) {
      return `Too many spec images (max ${MAX_REVIEWED_SPEC_IMAGES})`;
    }
    if (
      source.images.some(
        (image) =>
          !image.imageBase64.trim() ||
          image.imageBase64.length > MAX_REVIEWED_SPEC_IMAGE_BASE64_CHARS,
      )
    ) {
      return "A spec image is empty or too large";
    }
    return null;
  },
  toModelInput(prompt, source) {
    return {
      prompt,
      source: {
        kind: "spec-images",
        images: source.images.map((image) => ({
          mimeType: image.mimeType || "image/jpeg",
          imageBase64: image.imageBase64,
        })),
      },
    };
  },
};

export type ReviewedDocumentExtractionResult<T> =
  | { ok: true; data: T; metadata: AiStatusMetadata }
  | { ok: false; data: T; error: string; metadata: AiStatusMetadata };

/**
 * Extract a canonical, reviewable document without performing writes. The
 * sanitizer is mandatory and always runs before the optional reviewer, so a
 * reviewer never sees untrusted model shape. Handlers can pass any
 * already-grounded prompt and provider closure; no memory/DB policy is hidden
 * in this foundation.
 */
export async function extractReviewedDocument<TSource extends ReviewedDocumentSource, TCanonical>(input: {
  label: string;
  log: AiModelLogger;
  adapter: DocumentSourceAdapter<TSource>;
  source: TSource;
  prompt: GroundedDocumentPrompt;
  call: (modelInput: ReviewedDocumentModelInput) => Promise<string>;
  sanitize: (raw: unknown, source: TSource) => TCanonical;
  review?: (canonical: TCanonical) => Promise<TCanonical> | TCanonical;
  empty: () => TCanonical;
}): Promise<ReviewedDocumentExtractionResult<TCanonical>> {
  const validationError = input.adapter.validate(input.source);
  if (validationError) {
    return {
      ok: false,
      data: input.empty(),
      error: validationError,
      metadata: unavailableSuggestionMetadata("malformed"),
    };
  }

  const modelInput = input.adapter.toModelInput(input.prompt, input.source);
  const result = await runBoundedJsonModel({
    label: input.label,
    log: input.log,
    call: () => input.call(modelInput),
  });
  if (!result.ok) {
    return {
      ok: false,
      data: input.empty(),
      error: result.modelStatus,
      metadata: unavailableSuggestionMetadata(result.modelStatus),
    };
  }

  const sanitized = input.sanitize(result.raw, input.source);
  return {
    ok: true,
    data: input.review ? await input.review(sanitized) : sanitized,
    metadata: enrichedSuggestionMetadata(),
  };
}