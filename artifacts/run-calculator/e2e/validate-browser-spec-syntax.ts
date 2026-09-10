import { basename, dirname, resolve } from "node:path";
import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

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

  return sourceFile.parseDiagnostics.map((diagnostic) => {
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

function browserSpecErrors(fileUrl: URL): string[] {
  const filePath = fileURLToPath(fileUrl);
  const fileName = browserSpecFileName(fileUrl);
  const source = ts.sys.readFile(filePath);
  if (source == null) {
    return [`unable to read ${fileName}.`];
  }

  return browserSpecSyntaxErrors(source, fileName);
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