import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseModelCard } from "../cards.js";
import type { ExecutionCard } from "../types.js";

export interface ModelCardFile {
  path: string;
  card: ExecutionCard;
}

export class CardCatalogError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CardCatalogError";
  }
}

/**
 * Read only regular JSON files from one explicitly selected directory.
 * Selection and file ownership belong to the host; this function performs
 * no network calls, package installation, or plugin registration.
 */
export async function readModelCards(directory: string): Promise<ModelCardFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const filenames = entries
    .filter(entry => entry.isFile() && entry.name.endsWith(".json"))
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));

  const cards: ModelCardFile[] = [];
  const ids = new Set<string>();
  for (const filename of filenames) {
    const path = join(directory, filename);
    try {
      const data: unknown = JSON.parse(await readFile(path, "utf8"));
      const card = parseModelCard(data);
      if (ids.has(card.id)) throw new CardCatalogError(`duplicate card ID: ${card.id}`);
      ids.add(card.id);
      cards.push({ path, card });
    } catch (error) {
      throw new CardCatalogError(`invalid model card at ${path}: ${error instanceof Error ? error.message : "unknown error"}`, { cause: error });
    }
  }
  return cards;
}
