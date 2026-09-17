export type Flags = Record<string, string | boolean | string[]>;

const literalPrefix = "\0";

export function literal(value: string): string {
  return `${literalPrefix}${value}`;
}

export function unliteral(value: string): string {
  return value.startsWith(literalPrefix) ? value.slice(literalPrefix.length) : value;
}

export function parseArgs(
  args: string[],
  allowed: Record<string, "value" | "repeat" | "boolean">,
): { positionals: string[]; flags: Flags } {
  const positionals: string[] = [];
  const flags: Flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const kind = allowed[arg];
    if (!kind) throw new Error(`unknown flag: ${arg}`);
    if (kind === "boolean") {
      flags[arg] = true;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`${arg} requires a value`);
    index += 1;
    flags[arg] =
      kind === "repeat"
        ? [...((flags[arg] as string[] | undefined) ?? []), value]
        : value;
  }
  return { positionals, flags };
}

export function requireCount(
  values: string[],
  count: number,
  usage: string,
): void {
  if (values.length !== count) throw new Error(`usage: ${usage}`);
}
