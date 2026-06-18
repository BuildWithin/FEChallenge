/** Escape a CSV field per RFC 4180. */
function escapeCsvField(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Build CSV text from column headers and row objects. */
export function rowsToCsv(
  columns: string[],
  rows: Array<Record<string, unknown>>,
): string {
  const header = columns.map(escapeCsvField).join(",");
  const body = rows.map((row) =>
    columns.map((col) => escapeCsvField(row[col])).join(","),
  );
  return [header, ...body].join("\n");
}

/** Trigger a browser download of CSV content. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
