type CsvCell = string | number | boolean | null | undefined;

// Une cellule qui commence par l'un de ces caractères est interprétée comme une formule par Excel,
// LibreOffice ou Google Sheets. Les noms, motifs et descriptions exportés sont saisis par les
// utilisateurs de l'application : un nom « =HYPERLINK(...) » deviendrait un lien actif dans le fichier
// ouvert par l'équipe. Préfixer d'une apostrophe fait lire la cellule comme du texte (OWASP, CSV injection).
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export function escapeCell(value: CsvCell) {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "string" ? value : String(value);
  // Les nombres restent des nombres : -1500 est un montant, pas une formule.
  const stringValue = typeof value === "string" && FORMULA_TRIGGER.test(raw) ? `'${raw}` : raw;
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
