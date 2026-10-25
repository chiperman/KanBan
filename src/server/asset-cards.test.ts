import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { DatabaseSync } from "node:sqlite";

import { parseAssetCards, updateAssetCardLayout } from "./asset-cards";
import { CredentialFreeBusinessDataBackup } from "./backup/business-data-backup";
import { SqliteDashboardDatabase } from "./persistence/sqlite-database";
import type { Card } from "./ports";

const cards: Card[] = [
  { id: "first", kind: "asset", title: "First", body: "One", span: 1, hidden: true },
  { id: "second", kind: "asset", title: "Second", body: "Two", span: 2, startsNewRow: true },
];

test("retained layout updates preserve card content without mutating input", () => {
  const before = structuredClone(cards);
  const updated = updateAssetCardLayout(cards, { cards: [
    { id: "second", span: 3, hidden: true, startsNewRow: true, title: "ignored" },
    { id: "first", span: 2, hidden: false, startsNewRow: false },
  ] });
  assert.deepEqual(updated, [
    { ...cards[1], span: 3, hidden: true, startsNewRow: true },
    { ...cards[0], span: 2, hidden: undefined, startsNewRow: undefined },
  ]);
  assert.deepEqual(cards, before);
});

test("invalid layout replacements leave all retained metadata unchanged", () => {
  const before = structuredClone(cards);
  for (const input of [null, {}, { cards: [] },
    { cards: [{ id: "first", span: 1 }] },
    { cards: [{ id: "first", span: 1 }, { id: "first", span: 2 }] },
    { cards: [{ id: "unknown", span: 1 }, { id: "second", span: 2 }] },
    { cards: [{ id: "first", span: 4 }, { id: "second", span: 2 }] },
    { cards: [{ id: "first", span: 1, hidden: "true" }, { id: "second", span: 2 }] },
    { cards: [{ id: "first", span: 1, startsNewRow: 1 }, { id: "second", span: 2 }] },
  ]) assert.throws(() => updateAssetCardLayout(cards, input));
  assert.deepEqual(cards, before);
});

test("legacy layout parsing drops retired height and public-card fields", () => {
  assert.deepEqual(parseAssetCards([
    { ...cards[0], minHeight: 960 },
    { id: "legacy", access: "restricted", title: "Private", body: "Data", span: 3, minHeight: 900 },
    { id: "public", access: "public", title: "Public", body: "Removed", span: 1 },
  ]), [cards[0], { id: "legacy", kind: "asset", title: "Private", body: "Data", span: 3 }]);
  assert.equal(parseAssetCards([{ ...cards[0], span: 4 }]), null);
});

test("SQLite reopen and credential-free restore preserve retained layout facts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kanban-layout-contract-"));
  const databases: SqliteDashboardDatabase[] = [];
  const open = () => {
    const database = new SqliteDashboardDatabase(path.join(root, "dashboard.sqlite"));
    databases.push(database);
    return database;
  };
  try {
    const first = open();
    await first.replaceAssetCards(cards);
    const updated = updateAssetCardLayout(cards, { cards: [
      { id: "second", span: 3, hidden: true, startsNewRow: true },
      { id: "first", span: 2 },
    ] });
    const expected: Card[] = [
      { ...cards[1], span: 3, hidden: true, startsNewRow: true },
      { id: "first", kind: "asset", title: "First", body: "One", span: 2 },
    ];
    await first.replaceAssetCards(updated);
    const reloaded = open();
    assert.deepEqual(await reloaded.listAssetCards(), expected);
    const backup = new CredentialFreeBusinessDataBackup(reloaded, path.join(root, "backups"), {
      now: () => new Date("2026-10-02T00:00:00.000Z"),
    });
    const exported = await backup.exportBackup("layout.json");
    await reloaded.replaceAssetCards([]);
    await backup.restore(exported.fileName);
    assert.deepEqual(await open().listAssetCards(), expected);
  } finally {
    for (const database of databases) {
      (database as unknown as { database: DatabaseSync }).database.close();
    }
    await rm(root, { recursive: true, force: true });
  }
});
