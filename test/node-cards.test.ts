import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readModelCards, CardCatalogError } from "../src/node/cards.js";

const example = (id: string) => JSON.stringify({
  schemaVersion: "1.0", id,
  execution: { plugin: "@arcanai/plugin-ollama", instance: "mini", model: "qwen3:8b" }
});

test("reads selected JSON directory deterministically, without registering/installing plugins", async () => {
  const dir = await mkdtemp(join(tmpdir(), "arcanai-cards-"));
  try {
    await writeFile(join(dir, "z.json"), example("z"));
    await writeFile(join(dir, "a.json"), example("a"));
    await writeFile(join(dir, "note.txt"), "ignored");
    const cards = await readModelCards(dir);
    assert.deepEqual(cards.map(entry => entry.card.id), ["a", "z"]);
    assert.deepEqual(cards.map(entry => entry.card.execution.plugin), ["@arcanai/plugin-ollama", "@arcanai/plugin-ollama"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects duplicate model card identifiers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "arcanai-cards-"));
  try {
    await writeFile(join(dir, "a.json"), example("duplicate"));
    await writeFile(join(dir, "b.json"), example("duplicate"));
    await assert.rejects(readModelCards(dir), CardCatalogError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("refuses malformed cards rather than silently omitting them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "arcanai-cards-"));
  try {
    await writeFile(join(dir, "broken.json"), JSON.stringify({ schemaVersion: "900" }));
    await assert.rejects(readModelCards(dir), /invalid model card at/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("does not follow model card symlinks into unrelated folders", async () => {
  const dir = await mkdtemp(join(tmpdir(), "arcanai-cards-"));
  const outside = await mkdtemp(join(tmpdir(), "arcanai-external-"));
  try {
    await writeFile(join(outside, "outside.json"), example("outside"));
    await symlink(join(outside, "outside.json"), join(dir, "linked.json"));
    assert.deepEqual(await readModelCards(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
