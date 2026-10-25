import { readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { mapBinanceSnapshot } from "@/server/asset-sources/binance";

import {
  DatabaseAssetSourceConnections,
  SqliteDashboardDatabase,
  FileEncryptedSecretStore,
} from "@/server/production";
import {
  BINANCE_OBSERVED_AT,
  BINANCE_USDT_USD_QUOTE,
  binanceFixture,
} from "@/server/testing/binance-fixtures";
import { InMemoryAssetFullRefreshState } from "@/server/testing/fakes";
import { withTestDirectory } from "@/server/testing/temporary-directory";
import { testGuard } from "@/server/testing/route-support";
import { readSqliteFiles } from "@/server/testing/sqlite-files";

export const dynamic = "force-dynamic";

const API_KEY = "binance-persistence-api-key";
const API_SECRET = "binance-persistence-secret";

export async function POST() {
  const denied = testGuard();
  if (denied) return denied;
  return withTestDirectory("pad-ticket10-", async (root) => {
    const previousKey = process.env.PAD_SECRET_ENCRYPTION_KEY;
    process.env.PAD_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 10).toString("base64");
    try {
      const dashboardPath = path.join(root, "dashboard.sqlite");
      const secretsPath = path.join(root, "secrets.json");
      const database = new SqliteDashboardDatabase(dashboardPath);
      const secrets = new FileEncryptedSecretStore(secretsPath);
      const fixture = binanceFixture();
      const credentials = JSON.stringify({ apiKey: API_KEY, apiSecret: API_SECRET });
      await new DatabaseAssetSourceConnections(
        database,
        secrets,
        Promise.resolve(),
        { now: () => new Date(BINANCE_OBSERVED_AT) },
        new InMemoryAssetFullRefreshState(),
      ).connectBinance({
        credentials,
        permissions: ["market-data", "account", "positions"],
        account: { id: "binance:900001", label: "Binance 账户 · UID 900001" },
        snapshot: mapBinanceSnapshot({
          ...fixture,
          observedAt: BINANCE_OBSERVED_AT,
          usdtUsdQuote: BINANCE_USDT_USD_QUOTE,
        }),
      });
      const source = (await database.listSources())[0];
      const dashboardRaw = await readSqliteFiles(dashboardPath);
      const secretRaw = await readFile(secretsPath, "utf8");
      database.close();
      const reopenedDatabase = new SqliteDashboardDatabase(dashboardPath);
      let sourceSurvivesReopen: boolean;
      let dailySnapshotCount: number;
      try {
        sourceSurvivesReopen = isDeepStrictEqual(
          (await reopenedDatabase.listSources())[0], source,
        );
        dailySnapshotCount = (await reopenedDatabase.listDailyAssetSnapshots()).length;
      } finally {
        reopenedDatabase.close();
      }
      return Response.json({
        sourceKind: source.kind,
        sourceSurvivesReopen,
        dashboardHasOnlyReference:
          source.credentialReference !== null &&
          dashboardRaw.includes(source.credentialReference) &&
          !dashboardRaw.includes(API_KEY) &&
          !dashboardRaw.includes(API_SECRET),
        encryptedStoreHasNoPlaintext:
          !secretRaw.includes(API_KEY) && !secretRaw.includes(API_SECRET),
        committedSecretReadable:
          source.credentialReference !== null &&
          (await secrets.get(source.credentialReference)) === credentials,
        dailySnapshotCount,
      });
    } finally {
      if (previousKey === undefined) delete process.env.PAD_SECRET_ENCRYPTION_KEY;
      else process.env.PAD_SECRET_ENCRYPTION_KEY = previousKey;
    }
  });
}
