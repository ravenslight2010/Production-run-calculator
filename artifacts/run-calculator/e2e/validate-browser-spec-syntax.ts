import { basename, dirname, resolve } from "node:path";
import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "@workspace/typescript-api-v6";

const SYNTAX_ERROR_HEADER =
  "Browser spec syntax validation failed before database setup:";

export function browserSpecSyntaxErrors(
  source: string,
  fileName: string,
): string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  // createSourceFile supplies parser diagnostics at runtime, but the public
  // SourceFile declaration omits this compiler-internal property.
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  return parseDiagnostics.map((diagnostic) => {
    const position = diagnostic.start == null
      ? ""
      : `:${sourceFile.getLineAndCharacterOfPosition(diagnostic.start).line + 1}:${
        sourceFile.getLineAndCharacterOfPosition(diagnostic.start).character + 1
      }`;
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
    return `${fileName}${position}: ${message}`;
  });
}

function browserSpecFileName(fileUrl: URL): string {
  return basename(fileURLToPath(fileUrl)) || "browser spec";
}

export function browserSpecManagerDefaultsErrors(
  source: string,
  fileName: string,
): string[] {
  // This recognizes historical fixture copies, not production permissions.
  // Extra copied capabilities must not evade the guard as the role grows.
  const historicalBaseline = [
    "manage-staff",
    "manage-inventory",
    "edit-production-rules",
    "approve-password-resets",
    "review-incidents",
    "use-ai-tools",
    "manage-factory-settings",
    "manage-profiles",
  ];
  const sourceFile = ts.createSourceFile(
    fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS,
  );
  const errors: string[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isArrayLiteralExpression(node) &&
      node.elements.every(ts.isStringLiteral) &&
      historicalBaseline.every((capability) =>
        node.elements.some((element) =>
          ts.isStringLiteral(element) && element.text === capability))
    ) {
      let parent: ts.Node | undefined = node.parent;
      while (parent && !ts.isSourceFile(parent)) {
        const defaultDeclaration =
          ts.isVariableDeclaration(parent) &&
          ts.isIdentifier(parent.name) &&
          parent.name.text === "MANAGER_CAPABILITIES";
        const querySql =
          ts.isCallExpression(parent) &&
          ts.isPropertyAccessExpression(parent.expression) &&
          parent.expression.name.text === "query"
            ? parent.arguments[0]
            : undefined;
        const builtinManagerWrite =
          querySql != null &&
          ts.isStringLiteralLike(querySql) &&
          /UPDATE\s+roles\b[\s\S]*\bname\s*=\s*'manager'/i.test(querySql.text);
        if (defaultDeclaration || builtinManagerWrite) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(
            node.getStart(sourceFile),
          );
          errors.push(
            `${fileName}:${line + 1}: copied default-manager capabilities; ` +
            "use DEFAULT_MANAGER_CAPABILITIES. Express intentional access " +
            "restrictions explicitly rather than copying the old default role.",
          );
          break;
        }
        parent = parent.parent;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return errors;
}

function browserSpecErrors(fileUrl: URL): string[] {
  const filePath = fileURLToPath(fileUrl);
  const fileName = browserSpecFileName(fileUrl);
  const source = ts.sys.readFile(filePath);
  if (source == null) {
    return [`unable to read ${fileName}.`];
  }

  return [
    ...browserSpecSyntaxErrors(source, fileName),
    ...browserSpecManagerDefaultsErrors(source, fileName),
  ];
}

export function configuredBrowserSpecFiles(): URL[] {
  const e2eDirectory = dirname(fileURLToPath(import.meta.url));
  return readdirSync(e2eDirectory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".spec.ts"),
    )
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => pathToFileURL(resolve(e2eDirectory, entry.name)));
}

export function validateBrowserSpecSyntaxSet(fileUrls: readonly URL[]): void {
  const errors = fileUrls.flatMap((fileUrl) => browserSpecErrors(fileUrl));
  if (errors.length > 0) {
    throw new Error(
      [
        SYNTAX_ERROR_HEADER,
        ...errors.map((error) => `- ${error}`),
      ].join("\n"),
    );
  }
}

export function validateBrowserSpecSyntax(fileUrl: URL): void {
  validateBrowserSpecSyntaxSet([fileUrl]);
}

export function validateBrowserSpecSyntaxDirectory(
  directoryUrl: URL,
  ignoredFileNames: readonly string[] = [],
): void {
  const ignored = new Set(ignoredFileNames);
  const directoryPath = fileURLToPath(directoryUrl);
  const specFileNames = readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) =>
      entry.isFile() &&
      entry.name.endsWith(".spec.ts") &&
      !ignored.has(entry.name)
    )
    .map((entry) => entry.name)
    .sort();

  for (const fileName of specFileNames) {
    validateBrowserSpecSyntax(new URL(fileName, directoryUrl));
  }
}

function runSyntaxValidationCommand(): void {
  const requestedFiles = process.argv.slice(2);
  if (requestedFiles[0] === "--") {
    requestedFiles.shift();
  }
  const fileUrls =
    requestedFiles.length > 0
      ? requestedFiles.map((filePath) =>
          pathToFileURL(resolve(process.cwd(), filePath)))
      : configuredBrowserSpecFiles();

  if (fileUrls.length === 0) {
    console.error("No browser specs were found to validate.");
    process.exitCode = 1;
    return;
  }

  try {
    validateBrowserSpecSyntaxSet(fileUrls);
    console.log(
      `Browser spec syntax valid: ${fileUrls.length} file${
        fileUrls.length === 1 ? "" : "s"
      }.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const invokedFile = process.argv[1];
if (
  invokedFile != null &&
  pathToFileURL(resolve(invokedFile)).href === import.meta.url
) {
  runSyntaxValidationCommand();
}
