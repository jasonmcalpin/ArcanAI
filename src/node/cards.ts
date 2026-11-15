import { readdirSync, readFileSync, realpathSync, statSync, lstatSync } from "node:fs";
import { resolve, relative, isAbsolute, join } from "node:path";
import { parseModelCard } from "../cards.js";
import type { ExecutionCard } from "../types.js";

export interface ModelCardFile {
  path: string;
  card: ExecutionCard;
}

/** Directory or single .json file. Paths are explicitly provided by the host. */
export interface CardSource {
  /** Host-owned filesystem root; required to keep file selection bounded. */
  root: string;
  /** A folder such as "testing" / "models", or one .json file under root. */
  path: string;
}

export interface RawCardFile {
  path: string;
  value: unknown;
}

export class CardCatalogError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CardCatalogError";
  }
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\") && !isAbsolute(rel));
}

function rawCardPaths(source: CardSource): string[] {
  if (!source.root?.trim() || !source.path?.trim()) {
    throw new CardCatalogError("root and path are required for host-selected model card loading");
  }
  const root = realpathSync(resolve(source.root));
  const selected = resolve(root, source.path);
  if (!inside(root, selected)) throw new CardCatalogError("model card path is outside the configured root");
  if (lstatSync(selected).isSymbolicLink() || !inside(root, realpathSync(selected))) {
    throw new CardCatalogError("model card path resolves outside the configured root or is a symlink");
  }
  const stat = statSync(selected);
  if (stat.isFile()) {
    if (!selected.endsWith(".json")) throw new CardCatalogError("single model card must be a .json file");
    return [selected];
  }
  if (!stat.isDirectory()) throw new CardCatalogError("model card path must be a directory or JSON file");
  return readdirSync(selected, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(".json"))
    .map(entry => join(selected, entry.name))
    .sort((a, b) => a.localeCompare(b, "en"));
}

/**
 * Host-neutral filesystem selection: no required folder names or card schema.
 * BML can validate its historical v3 inventory; Aether can load canonical v1.
 * Never registers providers, installs dependencies, or evaluates card content.
 */
export function readCardFilesSync(source: CardSource): RawCardFile[] {
  let paths: string[];
  try { paths = rawCardPaths(source); }
  catch (error) {
    if (error instanceof CardCatalogError) throw error;
    throw new CardCatalogError(`unable to read model card path ${source.path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  return paths.map(path => {
    try {
      return { path, value: JSON.parse(readFileSync(path, "utf8")) as unknown };
    } catch (error) {
      throw new CardCatalogError(`invalid JSON model card at ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  });
}

/**
 * Read canonical ArcanAI cards from a host-selected folder/file.
 * The legacy string form remains for existing consumers, resolved from cwd.
 */
export async function readModelCards(source: CardSource | string): Promise<ModelCardFile[]> {
  const files = readCardFilesSync(typeof source === "string"
    ? { root: process.cwd(), path: source }
    : source);
  const ids = new Set<string>();
  return files.map(({ path, value }) => {
    try {
      const card = parseModelCard(value);
      if (ids.has(card.id)) throw new CardCatalogError(`duplicate card ID: ${card.id}`);
      ids.add(card.id);
      return { path, card };
    } catch (error) {
      throw new CardCatalogError(`invalid model card at ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  });
}
