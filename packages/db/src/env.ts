import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const globalForEnv = globalThis as typeof globalThis & {
  __shopifyAiBlogEnvLoaded?: boolean;
};

export function loadWorkspaceEnv(): void {
  if (globalForEnv.__shopifyAiBlogEnvLoaded) return;
  globalForEnv.__shopifyAiBlogEnvLoaded = true;

  const root = findWorkspaceRoot(process.cwd()) ?? findWorkspaceRoot(dirname(fileURLToPath(import.meta.url)));
  if (!root) return;

  for (const file of envFiles(root)) {
    loadEnvFile(file);
  }
}

function envFiles(root: string): string[] {
  const nodeEnv = process.env.NODE_ENV?.trim();
  return [
    nodeEnv ? join(root, `.env.${nodeEnv}.local`) : undefined,
    join(root, ".env.local"),
    nodeEnv ? join(root, `.env.${nodeEnv}`) : undefined,
    join(root, ".env")
  ].filter((file): file is string => Boolean(file));
}

function loadEnvFile(file: string): void {
  if (!existsSync(file)) return;

  const content = readFileSync(file, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed || process.env[parsed.key] !== undefined) continue;
    process.env[parsed.key] = parsed.value;
  }
}

function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!match) return null;

  return {
    key: match[1],
    value: unquoteEnvValue(match[2] ?? "")
  };
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if ((quote === "\"" || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1);
  }
  return trimmed.replace(/\s+#.*$/, "");
}

function findWorkspaceRoot(start: string): string | null {
  let current = start;
  for (let depth = 0; depth < 8; depth += 1) {
    const packageJson = join(current, "package.json");
    if (existsSync(packageJson) && existsSync(join(current, ".env.example"))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}
