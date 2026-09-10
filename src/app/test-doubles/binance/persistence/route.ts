import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { mapBinanceSnapshot } from "@/server/asset-sources/binance";
import { isTestEnv } from "@/server/composition";
import {
  DatabaseAssetSourceConnections,
  FileDashboardDatabase,
  FileEncryptedSecretStore,
} from "@/server/production";
import {
  BINANCE_OBSERVED_AT,
  BINANCE_USDT_USD_QUOTE,
  binanceFixture,
} from "@/server/testing/binance-fixtures";
import { InMemoryAssetFullRefreshState } from "@/server/testing/fakes";

export const dynamic = "force-dynamic";

const API_KEY = "binance-persistence-api-key";
const API_SECRET = "binance-persistence-secret";

export async function POST() {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const root = await mkdtemp(path.join(tmpdir(), "pad-ticket10-"));
  const previousKey = process.env.PAD_SECRET_ENCRYPTION_KEY;
  process.env.PAD_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 10).toString("base64");
  try {
    const dashboardPath = path.join(root, "dashboard.json");
    const secretsPath = path.join(root, "secrets.json");
    const database = new FileDashboardDatabase(
      dashboardPath,
      path.join(root, "legacy-cards.json"),
    );
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
    const dashboardRaw = await readFile(dashboardPath, "utf8");
    const secretRaw = await readFile(secretsPath, "utf8");
    return Response.json({
      sourceKind: source.kind,
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
      dailySnapshotCount: (await database.listDailyAssetSnapshots()).length,
    });
  } finally {
    if (previousKey === undefined) delete process.env.PAD_SECRET_ENCRYPTION_KEY;
    else process.env.PAD_SECRET_ENCRYPTION_KEY = previousKey;
    await rm(root, { recursive: true, force: true });
  }
}
