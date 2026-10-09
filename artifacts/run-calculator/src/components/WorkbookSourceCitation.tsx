import type { WorkbookCellReference } from "@workspace/spec-import";

export function formatWorkbookCellReference(source: WorkbookCellReference): string {
  return `${source.file ? `${source.file} · ` : ""}${source.sheet}!${source.cell}`;
}

export function WorkbookSourceCitation({
  source,
  label = "Source",
  unverified = false,
}: {
  source?: WorkbookCellReference | null;
  label?: string;
  unverified?: boolean;
}) {
  if (!source) return null;
  return (
    <p
      className="text-[11px] text-muted-foreground"
      data-testid="workbook-source-citation"
      data-unverified={unverified ? "true" : "false"}
    >
      {label}: {formatWorkbookCellReference(source)}
      {unverified ? <span className="ml-1 font-medium text-amber-600">· match not verified</span> : null}
    </p>
  );
}
