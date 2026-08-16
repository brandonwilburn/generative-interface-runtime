import type { CapabilityDescriptor } from "@/registry/capabilities";
import type { SourceRecord } from "./sourcesRegistry";

function returnShape(source: SourceRecord): string {
  const fields = source.schema.columns
    .map((column) => `${column.name}: ${column.type}`)
    .join(", ");
  return `Array<{ ${fields} }>`;
}

function profile(source: SourceRecord): string {
  return source.schema.columns.map((column) => {
    const details = [
      column.distinctCount !== undefined ? `${column.distinctCount.toLocaleString()} distinct` : undefined,
      column.min !== undefined ? `range ${column.min}…${column.max}` : undefined,
      column.samples.length > 0 ? `samples ${column.samples.slice(0, 3).map(String).join(" | ")}` : undefined,
    ].filter(Boolean).join(", ");
    return `${column.name} (${column.type}${details ? `; ${details}` : ""})`;
  }).join("; ");
}

export function capabilitiesFromSources(
  sources: SourceRecord[],
): CapabilityDescriptor[] {
  return sources.map((source) => ({
    name: source.capability,
    domain: "system",
    description: `${source.rowCount.toLocaleString()} immutable rows from ${source.name}. ${profile(source)}`,
    useWhen: `The user asks about data contained in ${source.name}.`,
    params: [],
    returns: returnShape(source),
  }));
}

export function summarizeSource(source: SourceRecord): string {
  const columnCount = source.schema.columns.length;
  return `${source.kind.toUpperCase()} · ${source.rowCount.toLocaleString()} rows · ${columnCount} column${columnCount === 1 ? "" : "s"}`;
}
