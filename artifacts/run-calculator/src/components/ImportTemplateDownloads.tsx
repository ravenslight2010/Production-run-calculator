import { useState } from "react";
import type { ImportFormat } from "@workspace/spec-import/import-preflight";
import { IMPORT_TEMPLATES } from "../importTemplateCatalog";

export default function ImportTemplateDownloads({ enabled }: { enabled: ReadonlySet<string> }) {
  const [busy, setBusy] = useState<ImportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const available = IMPORT_TEMPLATES.filter(({ format }) => enabled.has(format));
  if (!available.length) return null;
  return (
    <details className="rounded-md border border-border p-3">
      <summary className="cursor-pointer text-sm font-semibold">Optional blank import templates</summary>
      <p className="mt-2 text-xs text-muted-foreground">
        Start a new workbook with supported headers and one fictional example. Replace the example
        before importing. Existing customer layouts are still supported through the usual review
        and fallback; using a template is not required. Downloads do not import or apply anything.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {available.map(({ format, label, description }) => (
          <button key={format} type="button" disabled={busy !== null}
            className="min-h-11 rounded-md border border-border px-3 py-2 text-left text-xs hover:bg-muted disabled:opacity-50"
            onClick={async () => {
              setBusy(format);
              setError(null);
              try {
                const { downloadImportTemplate } = await import("../importTemplates");
                downloadImportTemplate(format);
              } catch {
                setError("Template download failed. Try again, or continue with your existing workbook.");
              } finally {
                setBusy(null);
              }
            }}>
            <span className="block font-semibold">{busy === format ? "Preparing…" : `Download ${label} (.xlsx)`}</span>
            <span className="mt-1 block text-muted-foreground">{description}</span>
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    </details>
  );
}
