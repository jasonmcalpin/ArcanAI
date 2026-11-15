import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readModelCards, readCardFilesSync, CardCatalogError } from "../src/node/cards.js";

const card = (id: string) => ({
  schemaVersion: "1.0", id,
  execution: { plugin: "@arcanai/plugin-ollama", model: "qwen3:4b", instance: "local" }
});

test("host supplies its own directory name and root; no global/default folder", async () => {
  const root = mkdtempSync(join(tmpdir(), "arcanai-sources-"));
  try {
    mkdirSync(join(root, "testing"));
    mkdirSync(join(root, "models"));
    writeFileSync(join(root, "testing", "b.json"), JSON.stringify(card("browser")));
    writeFileSync(join(root, "models", "a.json"), JSON.stringify(card("agent")));
    assert.deepEqual((await readModelCards({ root, path: "testing" })).map(x => x.card.id), ["browser"]);
    assert.deepEqual((await readModelCards({ root, path: "models" })).map(x => x.card.id), ["agent"]);
    assert.deepEqual((await readModelCards({ root, path: "models/a.json" })).map(x => x.card.id), ["agent"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("raw host adapter reads legacy benchmark cards without applying ArcanAI schema", () => {
  const root = mkdtempSync(join(tmpdir(), "arcanai-raw-"));
  try {
    mkdirSync(join(root, "testing"));
    const legacy = { schemaVersion: 3, candidate: { id: "legacy", compatibilityProfile: {} } };
    writeFileSync(join(root, "testing", "01.json"), JSON.stringify(legacy));
    assert.deepEqual(readCardFilesSync({ root, path: "testing" }).map(x => x.value), [legacy]);
    assert.throws(() => readCardFilesSync({ root, path: "../not-allowed" }), CardCatalogError);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("rejects file and directory symlinks and directories escaping root", () => {
  const root = mkdtempSync(join(tmpdir(), "arcanai-symlinks-"));
  const outside = mkdtempSync(join(tmpdir(), "arcanai-outside-"));
  try {
    writeFileSync(join(outside, "outside.json"), JSON.stringify(card("outside")));
    mkdirSync(join(root, "models"));
    symlinkSync(join(outside, "outside.json"), join(root, "models", "linked.json"));
    symlinkSync(outside, join(root, "linked-folder"));
    assert.deepEqual(readCardFilesSync({ root, path: "models" }), []);
    assert.throws(() => readCardFilesSync({ root, path: "linked-folder" }), CardCatalogError);
    assert.throws(() => readCardFilesSync({ root, path: "../" }), CardCatalogError);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("rejects duplicate canonical IDs even with custom host folder", async () => {
  const root = mkdtempSync(join(tmpdir(), "arcanai-dupes-"));
  try {
    mkdirSync(join(root, "models"));
    writeFileSync(join(root, "models", "a.json"), JSON.stringify(card("same")));
    writeFileSync(join(root, "models", "b.json"), JSON.stringify(card("same")));
    await assert.rejects(readModelCards({ root, path: "models" }), CardCatalogError);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
