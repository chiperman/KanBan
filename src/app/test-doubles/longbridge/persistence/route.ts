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
import { KeychainLongbridgeHoldingCandlestickReader } from "@/server/asset-sources/longbridge";
import { InMemoryAssetFullRefreshState } from "@/server/testing/fakes";
import type {
  AssetSourceRefresher,
  LongbridgeAuthorizationResult,
} from "@/server/ports";

export const dynamic = "force-dynamic";

const PROBE_SECRET = "production-persistence-probe-secret";
const ROTATED_SECRET = "production-rotated-refresh-secret";
const KEYCHAIN_REFERENCE = "macos-keychain:longbridge-persistence-probe";

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

const KEYCHAIN_RESULT: LongbridgeAuthorizationResult = {
  ...RESULT,
  credentials: KEYCHAIN_REFERENCE,
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
  if (new URL(request.url).searchParams.get("legacy") === "history") {
    try {
      const dashboardPath = path.join(root, "dashboard.json");
      await writeFile(dashboardPath, JSON.stringify({
        cards: [],
        assetSources: [],
        dailyAssetSnapshots: [{
          day: "2026-03-01",
          capturedAt: "2026-03-01T04:00:00.000Z",
          complete: true,
          total: { USD: "100", CNY: "720" },
          exchangeRates: [],
          sources: [{
            sourceId: "legacy-longbridge",
            label: "旧长桥记录",
            kind: "longbridge",
            capturedAt: "2026-03-01T04:00:00.000Z",
            complete: true,
            total: { USD: "100", CNY: "720" },
          }],
        }],
      }));
      const database = new FileDashboardDatabase(
        dashboardPath,
        path.join(root, "legacy-cards.json"),
      );
      const [observation] = await database.listDailyAssetTrendObservations();
      return Response.json({
        observation,
        source: observation?.sources[0] ?? null,
      });
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
    await new DatabaseAssetSourceConnections(
      database,
      secrets,
      Promise.resolve(),
      undefined,
      new InMemoryAssetFullRefreshState(),
    ).connectLongbridge(RESULT);
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
        Promise.resolve(),
        undefined,
        new InMemoryAssetFullRefreshState(),
      ).connectLongbridge(RESULT);
    } catch {
      failed = true;
    }
    const failureSecretRaw = await readFile(
      path.join(failureDir, "secrets.json"),
      "utf8",
    ).catch((error: unknown) => {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return "{}";
      }
      throw error;
    });

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
      Promise.resolve(),
      undefined,
      new InMemoryAssetFullRefreshState(),
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
        listTrendObservations: () =>
          rotationDashboard.listDailyAssetTrendObservations(),
        listImportedSourceHistoryObservations: () =>
          rotationDashboard.listImportedSourceHistoryObservations(),
        createIfAbsent: (snapshot) =>
          rotationDashboard.createDailyAssetSnapshotIfAbsent(snapshot),
        record: (snapshot, createBaseline) =>
          rotationDashboard.recordDailyAssetObservation(snapshot, createBaseline),
      },
      {
        read: async () => ({ attemptedAt: null, inProgressAt: null }),
        initialize: async () => false,
        claim: async () => "claimed",
        start: async () => undefined,
        finish: async () => undefined,
        clear: async () => undefined,
      },
    ).refresh("all");
    const rotationRaw = await readFile(
      path.join(rotationDir, "secrets.json"),
      "utf8",
    );
    const rotatedSource = (await rotationDashboard.listSources())[0];

    const keychainDir = path.join(root, "keychain");
    const keychainDatabase = new FileDashboardDatabase(
      path.join(keychainDir, "dashboard.json"),
      path.join(keychainDir, "legacy-cards.json"),
    );
    const keychainSecrets = new FileEncryptedSecretStore(
      path.join(keychainDir, "secrets.json"),
    );
    const keychainConnections = new DatabaseAssetSourceConnections(
      keychainDatabase,
      keychainSecrets,
      Promise.resolve(),
      undefined,
      new InMemoryAssetFullRefreshState(),
    );
    await keychainConnections.connectLongbridge(KEYCHAIN_RESULT);
    const [keychainSource] = await keychainDatabase.listSources();
    const keychainDashboardRaw = await readFile(
      path.join(keychainDir, "dashboard.json"),
      "utf8",
    );
    const keychainSecretsRaw = await readFile(
      path.join(keychainDir, "secrets.json"),
      "utf8",
    ).catch(() => "{}");
    let refreshReceivedKeychainReference = false;
    const keychainRefreshReport = await new SourceIsolatedAssetSynchronization(
      {
        list: () => keychainDatabase.listSources(),
        replaceAll: (sources) => keychainDatabase.replaceSources(sources),
        update: (source) => keychainDatabase.updateSource(source),
      },
      keychainSecrets,
      { now: () => new Date("2026-05-29T00:00:00.000Z") },
      {
        async refresh({ credentials }) {
          refreshReceivedKeychainReference = credentials === KEYCHAIN_REFERENCE;
          return { snapshot: KEYCHAIN_RESULT.snapshot };
        },
      },
      100,
      {
        list: () => keychainDatabase.listDailyAssetSnapshots(),
        listTrendObservations: () => keychainDatabase.listDailyAssetTrendObservations(),
        listImportedSourceHistoryObservations: () =>
          keychainDatabase.listImportedSourceHistoryObservations(),
        createIfAbsent: (snapshot) =>
          keychainDatabase.createDailyAssetSnapshotIfAbsent(snapshot),
        record: (snapshot, createBaseline) =>
          keychainDatabase.recordDailyAssetObservation(snapshot, createBaseline),
      },
      new InMemoryAssetFullRefreshState(),
    ).refresh("all", "all", keychainSource?.id);
    const keychainCandles = keychainSource === undefined
      ? []
      : await new KeychainLongbridgeHoldingCandlestickReader({
        credentialReference: () => KEYCHAIN_REFERENCE,
        async readCandlesticks() {
          return [{
            timestamp: 1_746_072_000,
            open: "100",
            high: "110",
            low: "90",
            close: "105",
            volume: "1000",
            turnover: "105000",
          }];
        },
      } as never).readCandlesticks({
        source: keychainSource,
        symbol: "NVDA.US",
        period: "day",
      });

    const reauthorizationDir = path.join(root, "keychain-reauthorization");
    const reauthorizationDatabase = new FileDashboardDatabase(
      path.join(reauthorizationDir, "dashboard.json"),
      path.join(reauthorizationDir, "legacy-cards.json"),
    );
    const reauthorizationSecrets = new FileEncryptedSecretStore(
      path.join(reauthorizationDir, "secrets.json"),
    );
    const reauthorizationConnections = new DatabaseAssetSourceConnections(
      reauthorizationDatabase,
      reauthorizationSecrets,
      Promise.resolve(),
      undefined,
      new InMemoryAssetFullRefreshState(),
    );
    await reauthorizationConnections.connectLongbridge(RESULT);
    const [legacySource] = await reauthorizationDatabase.listSources();
    await reauthorizationConnections.connectLongbridge(KEYCHAIN_RESULT);
    const [reauthorizedSource] = await reauthorizationDatabase.listSources();

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
      keychainReferencePersistsDirectly:
        keychainSource?.credentialReference === KEYCHAIN_REFERENCE &&
        keychainDashboardRaw.includes(KEYCHAIN_REFERENCE) &&
        keychainSecretsRaw === "{}",
      keychainReferenceRefreshesAndReadsCandles:
        keychainRefreshReport.successCount === 1 &&
        refreshReceivedKeychainReference &&
        keychainCandles[0]?.close === "105",
      reauthorizationReplacesLegacySecretReference:
        legacySource?.credentialReference !== null &&
        reauthorizedSource?.credentialReference === KEYCHAIN_REFERENCE &&
        legacySource?.credentialReference !== KEYCHAIN_REFERENCE &&
        (await reauthorizationSecrets.get(legacySource?.credentialReference ?? "")) === null,
    });
  } finally {
    if (previousKey === undefined) delete process.env.PAD_SECRET_ENCRYPTION_KEY;
    else process.env.PAD_SECRET_ENCRYPTION_KEY = previousKey;
    await rm(root, { recursive: true, force: true });
  }
}
