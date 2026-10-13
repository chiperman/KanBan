import { readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";


import {
  DatabaseAssetSourceConnections,
  SqliteDashboardDatabase,
  FileEncryptedSecretStore,
} from "@/server/production";
import {
  OKX_OBSERVED_AT,
  okxFixtureSnapshot,
} from "@/server/testing/okx-fixtures";
import { InMemoryAssetFullRefreshState } from "@/server/testing/fakes";
import { withTestDirectory } from "@/server/testing/temporary-directory";
import { testGuard } from "@/server/testing/route-support";
import { readSqliteFiles } from "@/server/testing/sqlite-files";

export const dynamic = "force-dynamic";

const API_KEY = "okx-persistence-api-key";
const API_SECRET = "okx-persistence-secret";
const PASSPHRASE = "okx-persistence-passphrase";

export async function POST() {
  const denied = testGuard();
  if (denied) return denied;
  return withTestDirectory("pad-ticket11-", async (root) => {
    const previousKey = process.env.PAD_SECRET_ENCRYPTION_KEY;
    process.env.PAD_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
    try {
      const dashboardPath = path.join(root, "dashboard.sqlite");
      const secretsPath = path.join(root, "secrets.json");
      const database = new SqliteDashboardDatabase(dashboardPath);
      const secrets = new FileEncryptedSecretStore(secretsPath);
      const credentials = JSON.stringify({
        apiKey: API_KEY,
        apiSecret: API_SECRET,
        passphrase: PASSPHRASE,
        region: "global",
      });
      await new DatabaseAssetSourceConnections(
        database,
        secrets,
        Promise.resolve(),
        { now: () => new Date(OKX_OBSERVED_AT) },
        new InMemoryAssetFullRefreshState(),
      ).connectOkx({
        credentials,
        permissions: ["market-data", "account", "positions"],
        account: { id: "okx:880001", label: "OKX 账户 · UID 880001" },
        scopeFingerprint: "880001:880001:0",
        snapshot: okxFixtureSnapshot(OKX_OBSERVED_AT),
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
          !dashboardRaw.includes(API_SECRET) &&
          !dashboardRaw.includes(PASSPHRASE),
        encryptedStoreHasNoPlaintext:
          !secretRaw.includes(API_KEY) &&
          !secretRaw.includes(API_SECRET) &&
          !secretRaw.includes(PASSPHRASE),
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
