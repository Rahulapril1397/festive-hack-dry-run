/** Minimal RFC 4180 CSV: quotes, escaped quotes, CRLF/LF, BOM. Pure; unit-tested. */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

/** CSV output with formula-injection guard. */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (v: unknown) => {
    let x = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(x) && !/^-?\d+(\.\d+)?$/.test(x)) x = `'${x}`;
    return /[",\n\r]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
  };
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
