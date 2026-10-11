export type WorkbookCellReference = {
  file?: string;
  sheet: string;
  cell: string;
};

/** Convert zero-based Excel row and column indexes to an A1 cell address. */
export function workbookCellAddress(rowIndex: number, columnIndex: number): string {
  if (
    !Number.isInteger(rowIndex) ||
    rowIndex < 0 ||
    rowIndex >= 1_048_576 ||
    !Number.isInteger(columnIndex) ||
    columnIndex < 0 ||
    columnIndex >= 16_384
  ) {
    throw new RangeError("Workbook cell indexes must be within Excel's worksheet limits.");
  }

  let column = columnIndex + 1;
  let letters = "";
  while (column > 0) {
    const remainder = (column - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    column = Math.floor((column - 1) / 26);
  }
  return `${letters}${rowIndex + 1}`;
}

export function workbookCellReference(
  sheet: string,
  rowIndex: number,
  columnIndex: number,
  file?: string,
): WorkbookCellReference {
  return {
    ...(file?.trim() ? { file: file.trim() } : {}),
    sheet,
    cell: workbookCellAddress(rowIndex, columnIndex),
  };
}
