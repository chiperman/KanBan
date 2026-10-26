import type { DatabaseSync } from "node:sqlite";
import { validateInvestmentBookState } from "@/domain/investment-books";
import { InvestmentBookLedger } from "@/server/investment-books";
import type { SqliteDashboardReadModel } from "./sqlite-read-model";

export class SqliteInvestmentBookStore extends InvestmentBookLedger {
  constructor(database: DatabaseSync, readModel: SqliteDashboardReadModel) {
    super({
      read() {
        const row = database.prepare("SELECT payload_json FROM investment_book_state WHERE id = 1").get() as { payload_json: string } | undefined;
        return row ? validateInvestmentBookState(JSON.parse(row.payload_json)) : undefined;
      },
      write(state) {
        database.prepare("INSERT INTO investment_book_state (id, payload_json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json")
          .run(JSON.stringify(state));
      },
    }, readModel);
  }
}
