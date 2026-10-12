import { migrateJsonToSqlite } from "../src/server/persistence/json-to-sqlite-migration";

const [databasePath, dashboardPath, cardsPath] = process.argv.slice(2);
if (!databasePath || !dashboardPath || !cardsPath) {
  throw new Error(
    "用法：pnpm migrate:json-to-sqlite <dashboard.sqlite> <dashboard.json> <cards.json>",
  );
}

const result = await migrateJsonToSqlite({
  databasePath,
  dashboardPath,
  cardsPath,
});
console.log(JSON.stringify(result));
