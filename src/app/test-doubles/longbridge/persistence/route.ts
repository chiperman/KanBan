import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { getTestServices, isTestEnv } from "@/server/composition";
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
    exchangeRates: [],
    syncedAt: "2026-01-01T00:00:00.000Z",
  },
};

export async function POST(request: Request) {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const root = await mkdtemp(path.join(tmpdir(), "pad-ticket06-"));
  if (new URL(request.url).searchParams.get("legacy") === "1") {
    try {
      const dashboardPath = path.join(root, "dashboard.json");
      await writeFile(dashboardPath, JSON.stringify({
        cards: [{
          id: "legacy-card",
          kind: "asset",
          access: "private",
          title: "长桥资产",
          body: "只读证券账户",
          sourceId: "legacy-source",
          span: 2,
        }],
        assetSources: [{
          id: "legacy-source",
          kind: "longbridge",
          label: "长桥 Ticket 06 账户",
          accountId: "legacy-account",
          permissions: ["market-data", "account", "positions"],
          credentialReference: "legacy-reference",
          snapshot: {
            total: { amount: "300", currency: "USD" },
            holdings: [{
              symbol: "AAPL.US",
              name: "Apple",
              quantity: "2",
              currency: "USD",
              marketValue: "200",
              costPrice: "90",
              platformProfit: "20",
              changePercent: "1",
            }, {
              symbol: "0700.HK",
              name: "Tencent",
              quantity: "10",
              currency: "HKD",
              marketValue: "500",
              costPrice: "48",
              platformProfit: "20",
              changePercent: "0.5",
            }],
            syncedAt: "2026-03-31T08:00:00.000Z",
          },
        }],
      }));
      const database = new FileDashboardDatabase(
        dashboardPath,
        path.join(root, "legacy-cards.json"),
      );
      const services = getTestServices();
      await services.cards.replaceAll(await database.listCards());
      await services.assetSources.replaceAll(await database.listSources());
      return Response.json({ ok: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
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
