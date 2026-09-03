type CsvCell = string | number | boolean | null | undefined;

function escapeCell(value: CsvCell) {
  if (value === null || value === undefined) return "";
  const stringValue = typeof value === "string" ? value : String(value);
  if (/[";\n,]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

type CsvHeaders<T extends Record<string, CsvCell>> = Array<{ key: keyof T & string; label: string }>;

export function rowsToCsv<T extends Record<string, CsvCell>>(headers: CsvHeaders<T>, rows: T[]): string;
export function rowsToCsv<T extends Record<string, CsvCell>>(rows: T[]): string;
export function rowsToCsv<T extends Record<string, CsvCell>>(headersOrRows: CsvHeaders<T> | T[], suppliedRows?: T[]) {
  const rows = suppliedRows ?? (headersOrRows as T[]);
  const headers: CsvHeaders<T> = suppliedRows
    ? headersOrRows as CsvHeaders<T>
    : Object.keys(rows[0] ?? {}).map((key) => ({ key: key as keyof T & string, label: key }));
  const headerLine = headers.map((header) => escapeCell(header.label)).join(";");
  const dataLines = rows.map((row) => headers.map((header) => escapeCell(row[header.key])).join(";"));
  return [headerLine, ...dataLines].join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  const bom = "\uFEFF";
  const blob = new Blob([`${bom}${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
