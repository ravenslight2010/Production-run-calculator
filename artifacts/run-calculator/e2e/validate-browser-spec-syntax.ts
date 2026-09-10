import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

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

export function validateBrowserSpecSyntax(fileUrl: URL): void {
  const filePath = fileURLToPath(fileUrl);
  const fileName = basename(filePath) || "browser spec";
  const source = ts.sys.readFile(filePath);
  if (source == null) {
    throw new Error(
      `Browser spec syntax validation failed before database setup: ` +
        `unable to read ${fileName}.`,
    );
  }

  const errors = browserSpecSyntaxErrors(source, fileName);
  if (errors.length > 0) {
    throw new Error(
      [
        "Browser spec syntax validation failed before database setup:",
        ...errors.map((error) => `- ${error}`),
      ].join("\n"),
    );
  }
}