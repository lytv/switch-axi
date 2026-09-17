import { encode } from "@toon-format/toon";

export function render(data: Record<string, unknown>, json = false): string {
  return json ? JSON.stringify(data, null, 2) : encode(data);
}

export function truncate(value: unknown, full: boolean, limit = 800): unknown {
  if (typeof value !== "string" || full || value.length <= limit) return value;
  return `${value.slice(0, limit)}... [${value.length} chars; use --full]`;
}
