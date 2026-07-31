import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { getTestServices, isTestEnv } from "@/server/composition";
import {
  DatabaseAssetSourceConnections,
  FileDashboardDatabase,
  FileEncryptedSecretStore,
} from "@/server/production";
import { SourceIsolatedAssetSynchronization } from "@/server/asset-synchronization";
import type {
  AssetSourceRefresher,
  LongbridgeAuthorizationResult,
} from "@/server/ports";

export const dynamic = "force-dynamic";

const PROBE_SECRET = "production-persistence-probe-secret";
const ROTATED_SECRET = "production-rotated-refresh-secret";

const RESULT: LongbridgeAuthorizationResult = {
  credentials: PROBE_SECRET,
  permissions: ["account", "positions"],
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
  if (new URL(request.url).searchParams.get("legacy") === "option") {
    try {
      const dashboardPath = path.join(root, "dashboard.json");
      await writeFile(dashboardPath, JSON.stringify({
        cards: [{
          id: "legacy-option-card",
          kind: "asset",
          title: "长桥美股",
          body: "只读证券账户",
          sourceId: "legacy-option-source",
          span: 2,
        }],
        assetSources: [{
          id: "legacy-option-source",
          kind: "longbridge",
          label: "长桥美股",
          displayName: "长桥美股",
          accountId: "legacy-option-account",
          permissions: ["market-data", "account", "positions"],
          credentialReference: "legacy-option-reference",
          snapshot: {
            total: { amount: "69930.10", currency: "USD" },
            holdings: [{
              symbol: "NVDA.US",
              name: "NVIDIA",
              quantity: "1",
              currency: "USD",
              assetClass: "securities",
              currentPrice: { amount: "69970.74", currency: "USD" },
              marketValue: "69970.74",
              sourceMarketValue: { amount: "69970.74", currency: "USD" },
              valuation: {
                status: "valued",
                priceSource: "Longbridge 实时行情",
                pricedAt: "2026-07-30T08:00:00.000Z",
              },
              costPrice: null,
              platformProfit: null,
              changePercent: null,
            }, {
              symbol: "NVDA260805C210000.US",
              name: "NVDA 260805 210 Call",
              quantity: "-1",
              currency: "USD",
              assetClass: "securities",
              currentPrice: null,
              marketValue: null,
              sourceMarketValue: null,
              valuation: {
                status: "unvalued",
                reason: "Longbridge 未返回可靠价格",
              },
              costPrice: "0.450",
              platformProfit: null,
              changePercent: null,
            }],
            exchangeRates: [],
            syncedAt: "2026-07-30T08:00:00.000Z",
          },
        }],
      }));
      const database = new FileDashboardDatabase(
        dashboardPath,
        path.join(root, "legacy-cards.json"),
      );
      const services = getTestServices();
      await services.assetCards.replaceAll(await database.listAssetCards());
      await services.assetSources.replaceAll(await database.listSources());
      return Response.json({ ok: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  if (new URL(request.url).searchParams.get("legacy") === "1") {
    try {
      const dashboardPath = path.join(root, "dashboard.json");
      await writeFile(dashboardPath, JSON.stringify({
        cards: [{
          id: "legacy-card",
          kind: "asset",
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
      await services.assetCards.replaceAll(await database.listAssetCards());
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
    const committedSecretReadable =
      (await secrets.get(reference)) === PROBE_SECRET;
    await secrets.replace(reference, ROTATED_SECRET);
    const rotatedSecretRaw = await readFile(secretPath, "utf8");

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

    const rotationDir = path.join(root, "rotation");
    const rotationDashboard = new FileDashboardDatabase(
      path.join(rotationDir, "dashboard.json"),
      path.join(rotationDir, "legacy-cards.json"),
    );
    const rotationSecrets = new FileEncryptedSecretStore(
      path.join(rotationDir, "secrets.json"),
    );
    await new DatabaseAssetSourceConnections(
      rotationDashboard,
      rotationSecrets,
    ).connectLongbridge(RESULT);
    const rotationReference =
      (await rotationDashboard.listSources())[0].credentialReference;
    const failingAfterRotation: AssetSourceRefresher = {
      async refresh({ persistCredentials }) {
        await persistCredentials(ROTATED_SECRET);
        throw new Error("轮换后下游行情失败");
      },
    };
    const rotationReport = await new SourceIsolatedAssetSynchronization(
      {
        list: () => rotationDashboard.listSources(),
        replaceAll: (sources) => rotationDashboard.replaceSources(sources),
        update: (source) => rotationDashboard.updateSource(source),
      },
      rotationSecrets,
      { now: () => new Date("2026-05-29T00:00:00.000Z") },
      failingAfterRotation,
      100,
      {
        list: () => rotationDashboard.listDailyAssetSnapshots(),
        createIfAbsent: (snapshot) =>
          rotationDashboard.createDailyAssetSnapshotIfAbsent(snapshot),
      },
    ).refresh("all");
    const rotationRaw = await readFile(
      path.join(rotationDir, "secrets.json"),
      "utf8",
    );
    const rotatedSource = (await rotationDashboard.listSources())[0];

    return Response.json({
      dashboardHasOnlyReference:
        dashboardRaw.includes(reference) &&
        !dashboardRaw.includes(PROBE_SECRET) &&
        !dashboardRaw.includes('"secrets"'),
      encryptedStoreHasNoPlaintext:
        !secretRaw.includes(PROBE_SECRET) &&
        secretRaw.includes('"state":"committed"'),
      committedSecretReadable,
      rotatedSecretReadableAndEncrypted:
        (await secrets.get(reference)) === ROTATED_SECRET &&
        !rotatedSecretRaw.includes(ROTATED_SECRET) &&
        !rotatedSecretRaw.includes(PROBE_SECRET),
      failedWriteRolledBack: failed && failureSecretRaw === "{}",
      orphanRecovered: orphanRaw === "{}",
      referencedPendingRecovered:
        (await recoveryStore.get(referenced)) === "referenced",
      rotatedBeforeDownstreamFailure:
        rotationReport.failureCount === 1 &&
        rotatedSource.credentialReference === rotationReference &&
        rotatedSource.sync.status === "expired" &&
        rotationReference !== null &&
        (await rotationSecrets.get(rotationReference)) === ROTATED_SECRET &&
        !rotationRaw.includes(ROTATED_SECRET),
    });
  } finally {
    if (previousKey === undefined) delete process.env.PAD_SECRET_ENCRYPTION_KEY;
    else process.env.PAD_SECRET_ENCRYPTION_KEY = previousKey;
    await rm(root, { recursive: true, force: true });
  }
}
