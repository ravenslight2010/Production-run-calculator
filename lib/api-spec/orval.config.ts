import { defineConfig, InputTransformerFn } from "orval";
import path from "path";
import { readFile, readdir, writeFile } from "node:fs/promises";

const root = path.resolve(__dirname, "..", "..");
// The freshness check sets this to a unique temporary directory so Orval
// never cleans or rewrites the checked-in generated output. Normal generation
// deliberately keeps using the source directories.
const outputRoot = process.env.ORVAL_CHECK_OUTPUT_ROOT;
const apiClientReactSrc = outputRoot
  ? path.resolve(outputRoot, "api-client-react")
  : path.resolve(root, "lib", "api-client-react", "src");
const apiZodSrc = outputRoot
  ? path.resolve(outputRoot, "api-zod")
  : path.resolve(root, "lib", "api-zod", "src");

async function trimGeneratedTrailingBlankLines(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await trimGeneratedTrailingBlankLines(entryPath);
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      const source = await readFile(entryPath, "utf8");
      const trimmed = `${source.trimEnd()}\n`;
      if (trimmed !== source) await writeFile(entryPath, trimmed);
    }
  }
}

// Our exports make assumptions about the title of the API being "Api" (i.e. generated output is `api.ts`).
const titleTransformer: InputTransformerFn = (config) => {
  config.info ??= {};
  config.info.title = "Api";

  return config;
};

export default defineConfig({
  "api-client-react": {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiClientReactSrc,
      target: "generated",
      client: "react-query",
      mode: "split",
      baseUrl: "/api",
      clean: true,
      prettier: true,
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: path.resolve(apiClientReactSrc, "custom-fetch.ts"),
          name: "customFetch",
        },
      },
    },
  },
  zod: {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiZodSrc,
      client: "zod",
      target: "generated",
      schemas: { path: "generated/types", type: "typescript" },
      mode: "split",
      clean: true,
      prettier: true,
      override: {
        zod: {
          version: 3,
          coerce: {
            query: ["boolean", "number", "string"],
            param: ["boolean", "number", "string"],
            body: ["bigint", "date"],
            response: ["bigint", "date"],
          },
        },
        useDates: true,
        useBigInt: true,
      },
    },
    hooks: {
      afterAllFilesWrite: async () => {
        await writeFile(
          path.resolve(apiZodSrc, "index.ts"),
          [
            "export { DownloadCanonicalOperationalReportParams } from './generated/api';",
            "export * from './generated/api';",
            "export * from './generated/types';",
            "",
          ].join("\n"),
        );
        await Promise.all([
          trimGeneratedTrailingBlankLines(path.resolve(apiClientReactSrc, "generated")),
          trimGeneratedTrailingBlankLines(path.resolve(apiZodSrc, "generated")),
        ]);
      },
    },
  },
});
