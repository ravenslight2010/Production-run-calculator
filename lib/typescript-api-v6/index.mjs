import ts from "typescript-api-v6";

export const TYPESCRIPT_API_V6_VERSION = "6.0.3";

if (ts.version !== TYPESCRIPT_API_V6_VERSION) {
  throw new Error(
    `@workspace/typescript-api-v6 requires TypeScript ${TYPESCRIPT_API_V6_VERSION}, resolved ${ts.version}. ` +
      "Keep the JavaScript API pinned until TypeScript 7 publishes a stable replacement and these consumers are migrated.",
  );
}

export default ts;