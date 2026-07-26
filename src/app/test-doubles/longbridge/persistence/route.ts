import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { isTestEnv } from "@/server/composition";
import {
  DatabaseAssetSourceConnections,
  FileDashboardDatabase,
  FileEncryptedSecretStore,
} from "@/server/production";
import type { LongbridgeAuthorizationResult } from "@/server/ports";

export const dynamic = "force-dynamic";

const PROBE_SECRET = "production-persistence-probe-secret";

const RESULT: LongbridgeAuthorizationResult = {
  credentials: PROBE_SECRET,
  permissions: ["market-data", "account", "positions"],
  account: { id: "probe-account", label: "长桥测试账户" },
  snapshot: {
    total: { amount: "1", currency: "USD" },
    holdings: [],
    syncedAt: "2026-01-01T00:00:00.000Z",
  },
};

export async function POST() {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const root = await mkdtemp(path.join(tmpdir(), "pad-ticket06-"));
  const previousKey = process.env.PAD_SECRET_ENCRYPTION_KEY;
  process.env.PAD_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  try {
    const successDir = path.join(root, "success");
    const dashboardPath = path.join(successDir, "dashboard.json");
    const secretPath = path.join(successDir, "secrets.json");
    const database = new FileDashboardDatabase(
      dashboardPath,
      path.join(successDir, "legacy-cards.json"),
    );
    const secrets = new FileEncryptedSecretStore(secretPath);
    await new DatabaseAssetSourceConnections(database, secrets).connectLongbridge(RESULT);
    const sources = await database.listSources();
    const reference = sources[0]?.credentialReference ?? "";
    const dashboardRaw = await readFile(dashboardPath, "utf8");
    const secretRaw = await readFile(secretPath, "utf8");

    const failureDir = path.join(root, "failure");
    const blockedDashboardPath = path.join(failureDir, "dashboard.json");
    await mkdir(blockedDashboardPath, { recursive: true });
    const failedSecrets = new FileEncryptedSecretStore(
      path.join(failureDir, "secrets.json"),
    );
    let failed = false;
    try {
      await new DatabaseAssetSourceConnections(
        new FileDashboardDatabase(
          blockedDashboardPath,
          path.join(failureDir, "legacy-cards.json"),
        ),
        failedSecrets,
      ).connectLongbridge(RESULT);
    } catch {
      failed = true;
    }
    const failureSecretRaw = await readFile(
      path.join(failureDir, "secrets.json"),
      "utf8",
    );

    const recoveryPath = path.join(root, "recovery", "secrets.json");
    const recoveryStore = new FileEncryptedSecretStore(recoveryPath);
    await recoveryStore.stage("orphan");
    await recoveryStore.recover(new Set());
    const orphanRaw = await readFile(recoveryPath, "utf8");
    const referenced = await recoveryStore.stage("referenced");
    await recoveryStore.recover(new Set([referenced]));

    return Response.json({
      dashboardHasOnlyReference:
        dashboardRaw.includes(reference) &&
        !dashboardRaw.includes(PROBE_SECRET) &&
        !dashboardRaw.includes('"secrets"'),
      encryptedStoreHasNoPlaintext:
        !secretRaw.includes(PROBE_SECRET) &&
        secretRaw.includes('"state":"committed"'),
      committedSecretReadable: (await secrets.get(reference)) === PROBE_SECRET,
      failedWriteRolledBack: failed && failureSecretRaw === "{}",
      orphanRecovered: orphanRaw === "{}",
      referencedPendingRecovered:
        (await recoveryStore.get(referenced)) === "referenced",
    });
  } finally {
    if (previousKey === undefined) delete process.env.PAD_SECRET_ENCRYPTION_KEY;
    else process.env.PAD_SECRET_ENCRYPTION_KEY = previousKey;
    await rm(root, { recursive: true, force: true });
  }
}
