import type { DatabaseSync } from "node:sqlite";
import type { Card } from "@/server/ports";
import type { SqliteRow } from "./contracts";

/** 卡片布局与来源卡片可见性写入模块；事务边界由调用方持有。 */
export class SqliteAssetCardStore {
  constructor(private readonly database: DatabaseSync) {}

  insert(card: Card, position: number): void {
    this.database
      .prepare(`
        INSERT INTO asset_cards (
          id, position, title, body, source_id, hidden, span, starts_new_row
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        card.id,
        position,
        card.title,
        card.body,
        card.sourceId ?? null,
        card.hidden === undefined ? null : Number(card.hidden),
        card.span,
        card.startsNewRow === undefined ? null : Number(card.startsNewRow),
      );
  }

  list(): Card[] {
    const rows = this.database
      .prepare("SELECT * FROM asset_cards ORDER BY position")
      .all() as SqliteRow[];
    return rows.map((row) => ({
      id: row.id as string,
      kind: "asset",
      title: row.title as string,
      body: row.body as string,
      span: row.span as 1 | 2 | 3,
      ...(row.source_id === null ? {} : { sourceId: row.source_id as string }),
      ...(row.hidden === null ? {} : { hidden: row.hidden === 1 }),
      ...(row.starts_new_row === null
        ? {}
        : { startsNewRow: row.starts_new_row === 1 }),
    }));
  }

  replace(cards: Card[]): void {
    this.database.exec("DELETE FROM asset_cards");
    cards.forEach((card, position) => this.insert(card, position));
  }

  append(card: Card): void {
    const row = this.database
      .prepare("SELECT COUNT(*) AS count FROM asset_cards")
      .get() as SqliteRow;
    this.insert(card, row.count as number);
  }

  deleteForSource(sourceId: string): void {
    this.database
      .prepare("DELETE FROM asset_cards WHERE source_id = ?")
      .run(sourceId);
    const rows = this.database
      .prepare("SELECT id, position FROM asset_cards ORDER BY position")
      .all() as SqliteRow[];
    const update = this.database.prepare(
      "UPDATE asset_cards SET position = ? WHERE id = ?",
    );
    rows.forEach((row, position) => {
      if (row.position !== position) update.run(position, row.id as string);
    });
  }

  setHidden(sourceId: string, hidden: boolean): void {
    if (
      this.database
        .prepare("SELECT id FROM asset_sources WHERE id = ?")
        .get(sourceId) === undefined
    ) {
      throw new Error("资产来源不存在");
    }
    const result = this.database
      .prepare("UPDATE asset_cards SET hidden = ? WHERE source_id = ?")
      .run(Number(hidden), sourceId);
    if (result.changes === 0) throw new Error("资产卡片不存在");
  }
}
