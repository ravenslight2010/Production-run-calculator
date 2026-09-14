export const SYNTHETIC_BENCHMARK_PRIVACY_FIXTURES = Object.freeze({
  personalData: {
    name: "Synthetic Person",
    email: "synthetic.person@example.invalid",
    phone: "+1-202-555-0199",
  },
  encodedContent: {
    base64: "U1lOVEhFVElDX1dPUktCT09LX0JZVEVT",
    dataUrl: "data:image/png;base64,U1lOVEhFVElDX1BIT1RPX0JZVEVT",
  },
  malformedInput: "\ud800<SYNTHETIC_MALFORMED_INPUT>",
  credential: "sk-synthetic-never-a-real-secret",
  rawPrompt: "SYNTHETIC_RAW_PROMPT: include private workbook rows",
  workbookContent: "SYNTHETIC_WORKBOOK_CONTENT: formula and source cells",
  photoContent: "SYNTHETIC_PHOTO_CONTENT: data:image/jpeg;base64,AAAA",
  providerPayload: {
    id: "synthetic-provider-response",
    output: "SYNTHETIC_PROVIDER_OUTPUT_LEAK",
    headers: { authorization: "Bearer synthetic-token" },
  },
  conversationText: "SYNTHETIC_CONVERSATION_TEXT: private user message",
} as const);

export const SYNTHETIC_BENCHMARK_SENSITIVE_MARKERS = Object.freeze([
  "Synthetic Person",
  "synthetic.person@example.invalid",
  "+1-202-555-0199",
  "U1lOVEhFVElDX1dPUktCT09LX0JZVEVT",
  "data:image/png;base64,U1lOVEhFVElDX1BIT1RPX0JZVEVT",
  "SYNTHETIC_MALFORMED_INPUT",
  "sk-synthetic-never-a-real-secret",
  "SYNTHETIC_RAW_PROMPT",
  "SYNTHETIC_WORKBOOK_CONTENT",
  "SYNTHETIC_PHOTO_CONTENT",
  "synthetic-provider-response",
  "SYNTHETIC_PROVIDER_OUTPUT_LEAK",
  "Bearer synthetic-token",
  "SYNTHETIC_CONVERSATION_TEXT",
] as const);