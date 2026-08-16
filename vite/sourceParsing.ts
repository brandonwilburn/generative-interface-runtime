export interface SourceColumn {
  name: string;
  type: "string" | "number" | "date" | "boolean";
  samples: unknown[];
  nullCount?: number;
  distinctCount?: number;
  min?: string | number;
  max?: string | number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const NUMERIC = /^-?\d+(\.\d+)?$/;
const BOOL = /^(true|false)$/i;

function inferColumn(
  rows: Array<Record<string, unknown>>,
  name: string,
): Pick<SourceColumn, "type" | "samples"> {
  let allNum = true;
  let allDate = true;
  let allBool = true;
  let hasValue = false;
  const samples: unknown[] = [];
  for (const row of rows) {
    const sample = row[name];
    if (sample === null || sample === undefined || sample === "") continue;
    hasValue = true;
    if (samples.length < 5) samples.push(sample);
    if (typeof sample === "number") {
      allDate = false;
      allBool = false;
      continue;
    }
    if (typeof sample === "boolean") {
      allNum = false;
      allDate = false;
      continue;
    }
    const value = String(sample);
    if (!NUMERIC.test(value)) allNum = false;
    if (!(ISO_DATE.test(value) || (!isNaN(Date.parse(value)) && /\d{4}/.test(value)))) allDate = false;
    if (!BOOL.test(value)) allBool = false;
  }
  if (allNum && hasValue) return { type: "number", samples };
  if (allDate && hasValue) return { type: "date", samples };
  if (allBool && hasValue) return { type: "boolean", samples };
  return { type: "string", samples };
}

export function inferSchema(rows: Array<Record<string, unknown>>): SourceColumn[] {
  if (rows.length === 0) return [];
  return Object.keys(rows[0]!).map((name) => ({ name, ...inferColumn(rows, name) }));
}

export function parseCsv(content: string): Array<Record<string, unknown>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  const finishRow = () => {
    row.push(cell);
    if (row.some((value) => value.length > 0)) rows.push(row);
    row = [];
    cell = "";
  };

  for (let index = 0; index < content.length; index++) {
    const character = content[index]!;
    if (inQuotes) {
      if (character === '"' && content[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (character === '"') {
        inQuotes = false;
      } else if (character === "\r" && content[index + 1] === "\n") {
        cell += "\n";
        index++;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      if (cell.length > 0) throw new Error(`Malformed CSV near character ${index + 1}.`);
      inQuotes = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      finishRow();
      if (character === "\r" && content[index + 1] === "\n") index++;
    } else {
      cell += character;
    }
  }
  if (inQuotes) throw new Error("CSV contains an unterminated quoted field.");
  if (cell.length > 0 || row.length > 0) finishRow();

  if (rows.length === 0) throw new Error("CSV is empty");
  const headers = rows[0]!.map((header, index) =>
    (index === 0 ? header.replace(/^\uFEFF/, "") : header).trim()
  );
  if (headers.some((header) => !header)) throw new Error("CSV headers cannot be empty.");
  if (new Set(headers).size !== headers.length) throw new Error("CSV headers must be unique.");

  return rows.slice(1).map((cells, index) => {
    if (cells.length !== headers.length) {
      throw new Error(`CSV row ${index + 2} has ${cells.length} columns; expected ${headers.length}.`);
    }
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

export function parseJson(content: string): Array<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(content);
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return [];
    if (parsed.some((row) => typeof row !== "object" || row === null || Array.isArray(row))) {
      throw new Error("JSON must be an array of objects.");
    }
    return parsed as Array<Record<string, unknown>>;
  }
  if (typeof parsed === "object" && parsed !== null) {
    const candidate = Object.values(parsed).find(
      (value) => Array.isArray(value) && value.length > 0 && value.every((row) => typeof row === "object" && row !== null && !Array.isArray(row)),
    );
    if (candidate) return candidate as Array<Record<string, unknown>>;
  }
  throw new Error("JSON must be an array of objects, or an object containing one.");
}

export function coerceRow(
  row: Record<string, unknown>,
  columns: SourceColumn[],
): Record<string, string | number | null> {
  return Object.fromEntries(columns.map((column) => {
    const raw = row[column.name];
    if (raw === undefined || raw === null || raw === "") return [column.name, raw === undefined ? null : raw];
    if (column.type === "number") {
      const number = typeof raw === "number" ? raw : Number(raw);
      return [column.name, isFinite(number) ? number : String(raw)];
    }
    if (column.type === "boolean") {
      if (typeof raw === "boolean") return [column.name, raw ? 1 : 0];
      return [column.name, String(raw).toLowerCase() === "true" ? 1 : 0];
    }
    if (column.type === "date") {
      const value = String(raw);
      if (ISO_DATE.test(value)) return [column.name, value];
      const timestamp = Date.parse(value);
      return [column.name, isNaN(timestamp) ? value : new Date(timestamp).toISOString()];
    }
    return [column.name, String(raw)];
  }));
}
