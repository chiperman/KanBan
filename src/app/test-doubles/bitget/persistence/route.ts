import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { isTestEnv } from "@/server/composition";
import {
  DatabaseAssetSourceConnections,
  FileDashboardDatabase,
  FileEncryptedSecretStore,
} from "@/server/production";
import {
  BITGET_OBSERVED_AT,
  bitgetFixtureSnapshot,
} from "@/server/testing/bitget-fixtures";
import { InMemoryAssetFullRefreshState } from "@/server/testing/fakes";

export const dynamic = "force-dynamic";

const API_KEY = "bitget-persistence-api-key";
const API_SECRET = "bitget-persistence-secret";
const PASSPHRASE = "bitget-persistence-passphrase";

export async function POST() {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const root = await mkdtemp(path.join(tmpdir(), "pad-ticket12-"));
  const previousKey = process.env.PAD_SECRET_ENCRYPTION_KEY;
  process.env.PAD_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
  try {
    const dashboardPath = path.join(root, "dashboard.json");
    const secretsPath = path.join(root, "secrets.json");
    const database = new FileDashboardDatabase(
      dashboardPath,
      path.join(root, "legacy-cards.json"),
    );
    const secrets = new FileEncryptedSecretStore(secretsPath);
    const credentials = JSON.stringify({
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      passphrase: PASSPHRASE,
      accountMode: "classic",
    });
    await new DatabaseAssetSourceConnections(
      database,
      secrets,
      Promise.resolve(),
      { now: () => new Date(BITGET_OBSERVED_AT) },
      new InMemoryAssetFullRefreshState(),
    ).connectBitget({
      credentials,
      accountMode: "classic",
      permissions: ["market-data", "account", "positions"],
      account: { id: "bitget:770001", label: "Bitget 账户 · UID 770001" },
      scopeFingerprint: "770001:770001:classic:stor,wtor",
      snapshot: bitgetFixtureSnapshot(BITGET_OBSERVED_AT),
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
        !dashboardRaw.includes(API_SECRET) &&
        !dashboardRaw.includes(PASSPHRASE),
      encryptedStoreHasNoPlaintext:
        !secretRaw.includes(API_KEY) &&
        !secretRaw.includes(API_SECRET) &&
        !secretRaw.includes(PASSPHRASE),
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
