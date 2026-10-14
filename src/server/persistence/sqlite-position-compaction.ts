import type { SqliteRow } from "@/server/persistence/contracts";
import type { DatabaseSync } from "node:sqlite";

/** 删除或重排后把 `position` 压紧为从 0 开始的连续序号。 */
export function compactPositions(
  database: DatabaseSync,
  table: "asset_cards" | "asset_sources",
): void {
  const rows = database
    .prepare(`SELECT id, position FROM ${table} ORDER BY position`)
    .all() as SqliteRow[];
  const update = database.prepare(
    `UPDATE ${table} SET position = ? WHERE id = ?`,
  );
  rows.forEach((row, position) => {
    if (row.position !== position) update.run(position, row.id as string);
  });
}
