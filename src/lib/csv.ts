import type { FollowRow } from "@/lib/follows";

const REQUIRED_COLUMNS = [
  "accountId",
  "handle",
  "name",
  "lastPostAt",
  "status",
  "url",
] as const;

export type CsvParseResult =
  | { ok: true; rows: FollowRow[]; skipped: number }
  | { ok: false; error: string };

export function parseFollowsCsv(text: string): CsvParseResult {
  const records = parseCsvRecords(text.replace(/^\uFEFF/, ""));
  if (records.length === 0) {
    return { ok: false, error: "CSV is empty." };
  }

  const header = records[0].map((cell) => cell.trim());
  const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing columns: ${missing.join(", ")}. Expected ${REQUIRED_COLUMNS.join(", ")}.`,
    };
  }

  const index = Object.fromEntries(
    REQUIRED_COLUMNS.map((column) => [column, header.indexOf(column)]),
  ) as Record<(typeof REQUIRED_COLUMNS)[number], number>;

  const rows: FollowRow[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (let i = 1; i < records.length; i++) {
    const record = records[i];
    if (record.every((cell) => cell.trim() === "")) continue;

    const accountId = record[index.accountId]?.trim() ?? "";
    if (!accountId) {
      skipped += 1;
      continue;
    }
    if (seen.has(accountId)) {
      skipped += 1;
      continue;
    }
    seen.add(accountId);

    const handle = record[index.handle]?.trim() ?? "";
    const lastRaw = record[index.lastPostAt]?.trim() ?? "";

    rows.push({
      accountId,
      handle,
      name: record[index.name]?.trim() ?? "",
      lastPostAt: lastRaw === "" ? null : lastRaw,
      status: record[index.status]?.trim() ?? "",
      url: record[index.url]?.trim() || (handle ? `https://x.com/${handle}` : ""),
    });
  }

  if (rows.length === 0) {
    return { ok: false, error: "No follow rows found after the header." };
  }

  return { ok: true, rows, skipped };
}

export function parseCsvRecords(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
