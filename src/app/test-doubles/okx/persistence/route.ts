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
  OKX_OBSERVED_AT,
  okxFixtureSnapshot,
} from "@/server/testing/okx-fixtures";

export const dynamic = "force-dynamic";

const API_KEY = "okx-persistence-api-key";
const API_SECRET = "okx-persistence-secret";
const PASSPHRASE = "okx-persistence-passphrase";

export async function POST() {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const root = await mkdtemp(path.join(tmpdir(), "pad-ticket11-"));
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
      region: "global",
    });
    await new DatabaseAssetSourceConnections(
      database,
      secrets,
      Promise.resolve(),
      { now: () => new Date(OKX_OBSERVED_AT) },
    ).connectOkx({
      credentials,
      permissions: ["market-data", "account", "positions"],
      account: { id: "okx:880001", label: "OKX 账户 · UID 880001" },
      scopeFingerprint: "880001:880001:0",
      snapshot: okxFixtureSnapshot(OKX_OBSERVED_AT),
    });
    const source = (await database.listSources())[0];
    const dashboardRaw = await readFile(dashboardPath, "utf8");
    const secretRaw = await readFile(secretsPath, "utf8");
    return Response.json({
      sourceKind: source.kind,
      dashboardHasOnlyReference:
        dashboardRaw.includes(source.credentialReference) &&
        !dashboardRaw.includes(API_KEY) &&
        !dashboardRaw.includes(API_SECRET) &&
        !dashboardRaw.includes(PASSPHRASE),
      encryptedStoreHasNoPlaintext:
        !secretRaw.includes(API_KEY) &&
        !secretRaw.includes(API_SECRET) &&
        !secretRaw.includes(PASSPHRASE),
      committedSecretReadable:
        (await secrets.get(source.credentialReference)) === credentials,
      dailySnapshotCount: (await database.listDailyAssetSnapshots()).length,
    });
  } finally {
    if (previousKey === undefined) delete process.env.PAD_SECRET_ENCRYPTION_KEY;
    else process.env.PAD_SECRET_ENCRYPTION_KEY = previousKey;
    await rm(root, { recursive: true, force: true });
  }
}
