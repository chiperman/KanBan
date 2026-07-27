import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";

import { isTestEnv } from "@/server/composition";
import {
  DatabaseAssetSourceConnections,
  SqliteDashboardDatabase,
  createProductionServices,
} from "@/server/production";
import type {
  AssetSnapshot,
  BinanceAuthorizationResult,
  DailyAssetSnapshot,
} from "@/server/ports";

export const dynamic = "force-dynamic";

async function exists(filePath: string): Promise<boolean> {
  return access(filePath).then(
    () => true,
    () => false,
  );
}

function displayMode(mode: number): string {
  return (mode & 0o777).toString(8).padStart(4, "0");
}

function legacyDashboard() {
  const capturedAt = "2026-07-27T04:00:00.000Z";
  return {
    schemaVersion: 5,
    assetCards: [
      {
        id: "legacy-card",
        kind: "asset",
        title: "旧资产卡片",
        body: "旧布局",
        sourceId: "legacy-source",
        hidden: true,
        span: 2,
        startsNewRow: true,
      },
    ],
    assetSources: [
      {
        id: "legacy-source",
        kind: "binance",
        label: "旧 Binance",
        accountId: "legacy-account",
        permissions: ["account", "positions"],
        credentialReference: "opaque-reference",
        lifecycle: "disconnected",
        snapshot: {
          total: { amount: "12.5", currency: "USD" },
          holdings: [
            {
              symbol: "USD",
              name: "US Dollar",
              quantity: "12.5",
              currency: "USD",
              assetClass: "crypto",
              currentPrice: { amount: "1", currency: "USD" },
              marketValue: "12.5",
              sourceMarketValue: { amount: "12.5", currency: "USD" },
              valuation: {
                status: "valued",
                priceSource: "旧 Binance",
                pricedAt: capturedAt,
              },
              costPrice: null,
              platformProfit: null,
              changePercent: null,
            },
          ],
          exchangeRates: [],
          syncedAt: capturedAt,
        },
        sync: {
          status: "current",
          lastSuccessfulAt: capturedAt,
          lastAttemptAt: capturedAt,
          error: null,
        },
      },
    ],
    dailyAssetSnapshots: [
      {
        day: "2026-07-27",
        capturedAt,
        complete: true,
        total: { USD: "12.5", CNY: "90" },
        sources: [
          {
            sourceId: "legacy-source",
            label: "旧 Binance",
            kind: "binance",
            capturedAt,
            complete: true,
            total: { USD: "12.5", CNY: "90" },
          },
        ],
      },
    ],
  };
}

async function writeLegacyDashboard(dataDirectory: string): Promise<string> {
  await mkdir(dataDirectory, { recursive: true });
  const dashboardPath = path.join(dataDirectory, "dashboard.json");
  const contents = JSON.stringify(legacyDashboard(), null, 2);
  await writeFile(dashboardPath, contents);
  await chmod(dashboardPath, 0o600);
  return contents;
}

function authorization(
  accountId: string,
  credentials: string,
  invalidSnapshot = false,
): BinanceAuthorizationResult {
  const snapshot = legacyDashboard().assetSources[0].snapshot as unknown as
    AssetSnapshot;
  return {
    credentials,
    permissions: ["account", "positions"],
    account: { id: accountId, label: `Binance ${accountId}` },
    snapshot: invalidSnapshot
      ? {
          ...snapshot,
          holdings: [...snapshot.holdings, 1n as never],
        }
      : snapshot,
  };
}

function dailySnapshot(
  sourceId: string,
  usd: string,
  cny: string,
): DailyAssetSnapshot {
  const capturedAt = "2026-07-28T02:00:00.000Z";
  return {
    day: "2026-07-28",
    capturedAt,
    complete: true,
    total: { USD: usd, CNY: cny },
    sources: [
      {
        sourceId,
        label: sourceId,
        kind: "test",
        capturedAt,
        complete: true,
        total: { USD: usd, CNY: cny },
      },
    ],
  };
}

function twoPartyBarrier(): () => Promise<void> {
  let arrivals = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrivals += 1;
    if (arrivals === 2) release();
    await ready;
  };
}

function memoryTransactionalSecrets(
  reference: string,
  arrive: () => Promise<void>,
) {
  const values = new Map<string, string>();
  return {
    async stage(value: string) {
      values.set(reference, value);
      await arrive();
      return reference;
    },
    async commit(target: string) {
      if (!values.has(target)) throw new Error("pending secret missing");
    },
    async put(value: string) {
      values.set(reference, value);
      return reference;
    },
    async get(target: string) {
      return values.get(target) ?? null;
    },
    async replace(target: string, value: string) {
      values.set(target, value);
    },
    async remove(target: string) {
      values.delete(target);
    },
  };
}

async function sqliteFilesContain(
  dataDirectory: string,
  needles: string[],
): Promise<boolean> {
  const names = ["dashboard.sqlite", "dashboard.sqlite-wal", "dashboard.sqlite-shm"];
  const buffers = await Promise.all(
    names.map(async (name) => {
      const filePath = path.join(
        /* turbopackIgnore: true */ dataDirectory,
        name,
      );
      return (await exists(filePath))
        ? readFile(/* turbopackIgnore: true */ filePath)
        : Buffer.alloc(0);
    }),
  );
  return needles.some((needle) =>
    buffers.some((buffer) => buffer.includes(Buffer.from(needle))),
  );
}

async function exerciseSqliteLockContention(
  databasePath: string,
): Promise<boolean> {
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec(`
    CREATE TABLE concurrency_probe (id TEXT PRIMARY KEY) STRICT;
    BEGIN IMMEDIATE;
    INSERT INTO concurrency_probe (id) VALUES ('main');
  `);
  const state = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  const worker = new Worker(
    `
      const { workerData, parentPort } = require("node:worker_threads");
      const { DatabaseSync } = require("node:sqlite");
      const state = new Int32Array(workerData.state);
      const database = new DatabaseSync(workerData.databasePath);
      database.exec("PRAGMA busy_timeout = 5000");
      Atomics.store(state, 0, 1);
      Atomics.notify(state, 0);
      database.exec("BEGIN IMMEDIATE");
      database.prepare("INSERT INTO concurrency_probe (id) VALUES (?)").run("worker");
      database.exec("COMMIT");
      database.close();
      parentPort.postMessage("done");
    `,
    {
      eval: true,
      workerData: { databasePath, state: state.buffer },
    },
  );
  let workerDone = false;
  const completion = new Promise<void>((resolve, reject) => {
    worker.on("message", (message) => {
      if (message === "done") {
        workerDone = true;
        resolve();
      }
    });
    worker.on("error", reject);
  });
  try {
    while (Atomics.load(state, 0) === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    const waitedForLock = !workerDone;
    database.exec("COMMIT");
    await completion;
    const row = database
      .prepare("SELECT COUNT(*) AS count FROM concurrency_probe")
      .get() as { count: number };
    return waitedForLock && row.count === 2;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // 保留原始并发测试错误。
    }
    throw error;
  } finally {
    await worker.terminate();
    database.close();
  }
}

export async function POST(request: Request) {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const action = new URL(request.url).searchParams.get("action");
  if (
    action !== "empty-startup" &&
    action !== "json-import" &&
    action !== "repeat-import" &&
    action !== "connection-rollback" &&
    action !== "credential-commit-rollback" &&
    action !== "concurrent-writes" &&
    action !== "daily-idempotency" &&
    action !== "source-lifecycle" &&
    action !== "delete-middle-source" &&
    action !== "startup-failures"
  ) {
    return Response.json({ error: "unknown action" }, { status: 400 });
  }

  const root = await mkdtemp(path.join(tmpdir(), "pad-sqlite-persistence-"));
  const dataDirectory = path.join(root, "data");
  const previousKey = process.env.PAD_SECRET_ENCRYPTION_KEY;
  process.env.PAD_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 21).toString("base64");
  try {
    if (action === "json-import" || action === "repeat-import") {
      const legacyContents = await writeLegacyDashboard(dataDirectory);
      const first = createProductionServices(dataDirectory);
      await first.secrets.get("startup-ready");
      if (action === "repeat-import") {
        const changed = legacyDashboard();
        changed.assetCards = [];
        changed.assetSources = [];
        changed.dailyAssetSnapshots = [];
        await writeFile(
          path.join(dataDirectory, "dashboard.json"),
          JSON.stringify(changed),
        );
        const restarted = createProductionServices(dataDirectory);
        await restarted.secrets.get("startup-ready");
        return Response.json({
          cardIds: (await restarted.assetCards.list()).map(({ id }) => id),
          sourceIds: (await restarted.assetSources.list()).map(({ id }) => id),
        });
      }

      const [card] = await first.assetCards.list();
      const [source] = await first.assetSources.list();
      const [dailySnapshot] = await first.dailyAssetSnapshots.list();
      const databasePath = path.join(dataDirectory, "dashboard.sqlite");
      const backupPath = path.join(
        dataDirectory,
        "dashboard.json.migration-backup",
      );
      return Response.json({
        card,
        source: {
          id: source.id,
          credentialReference: source.credentialReference,
          lifecycle: source.lifecycle,
          holdings: source.snapshot.holdings,
        },
        dailySnapshot: {
          day: dailySnapshot.day,
          total: dailySnapshot.total,
          sourceIds: dailySnapshot.sources.map(({ sourceId }) => sourceId),
        },
        databaseMode: displayMode((await stat(databasePath)).mode),
        backupMode: displayMode((await stat(backupPath)).mode),
        backupMatches: (await readFile(backupPath, "utf8")) === legacyContents,
      });
    }

    if (action === "startup-failures") {
      const corruptDirectory = path.join(root, "corrupt");
      const invalidJsonDirectory = path.join(root, "invalid-json");
      await mkdir(corruptDirectory, { recursive: true });
      const corruptPath = path.join(corruptDirectory, "dashboard.sqlite");
      const corruptContents = Buffer.from("not-a-sqlite-database");
      await writeFile(corruptPath, corruptContents);
      let corruptError = "";
      try {
        createProductionServices(corruptDirectory);
      } catch (error) {
        corruptError = error instanceof Error ? error.message : String(error);
      }

      await mkdir(invalidJsonDirectory, { recursive: true });
      const invalidJsonPath = path.join(invalidJsonDirectory, "dashboard.json");
      const invalidJsonContents = "{invalid-json";
      await writeFile(invalidJsonPath, invalidJsonContents);
      let invalidJsonError = "";
      try {
        createProductionServices(invalidJsonDirectory);
      } catch (error) {
        invalidJsonError = error instanceof Error ? error.message : String(error);
      }
      return Response.json({
        corruptDatabaseRejected: corruptError.length > 0,
        corruptDatabasePreserved:
          Buffer.compare(await readFile(corruptPath), corruptContents) === 0,
        invalidJsonRejected: invalidJsonError.length > 0,
        invalidJsonPreserved:
          (await readFile(invalidJsonPath, "utf8")) === invalidJsonContents,
        recoverableErrors:
          corruptError.includes("已停止启动") &&
          invalidJsonError.includes("已停止启动"),
      });
    }

    if (action === "connection-rollback") {
      const credentials = "rollback-api-secret";
      const services = createProductionServices(dataDirectory);
      await services.secrets.get("startup-ready");
      let rejected = false;
      try {
        await services.assetSourceConnections.connectBinance(
          authorization("rollback", credentials, true),
        );
      } catch {
        rejected = true;
      }
      return Response.json({
        rejected,
        cards: (await services.assetCards.list()).length,
        sources: (await services.assetSources.list()).length,
        dailySnapshots: (await services.dailyAssetSnapshots.list()).length,
        rawSecretLeaked: await sqliteFilesContain(dataDirectory, [credentials]),
      });
    }

    if (action === "credential-commit-rollback") {
      await mkdir(dataDirectory, { recursive: true });
      const database = new SqliteDashboardDatabase(
        path.join(dataDirectory, "dashboard.sqlite"),
        path.join(dataDirectory, "dashboard.json"),
        path.join(dataDirectory, "cards.json"),
      );
      let pendingSecret = true;
      const failingSecrets = {
        async stage() {
          return "pending-reference";
        },
        async commit() {
          throw new Error("credential commit failed");
        },
        async put() {
          throw new Error("not used");
        },
        async get() {
          return null;
        },
        async replace() {},
        async remove() {
          pendingSecret = false;
        },
      };
      const connections = new DatabaseAssetSourceConnections(
        database,
        failingSecrets,
        Promise.resolve(),
        { now: () => new Date("2026-07-28T02:00:00.000Z") },
      );
      let rejected = false;
      try {
        await connections.connectBinance(
          authorization("commit-failure", "commit-failure-secret"),
        );
      } catch {
        rejected = true;
      }
      return Response.json({
        rejected,
        pendingSecretRemoved: !pendingSecret,
        cards: (await database.listAssetCards()).length,
        sources: (await database.listSources()).length,
        dailySnapshots: (await database.listDailyAssetSnapshots()).length,
      });
    }

    if (action === "concurrent-writes") {
      const credentials = ["concurrent-secret-one", "concurrent-secret-two"];
      await mkdir(dataDirectory, { recursive: true });
      const databasePath = path.join(dataDirectory, "dashboard.sqlite");
      const legacyDashboardPath = path.join(dataDirectory, "dashboard.json");
      const legacyCardsPath = path.join(dataDirectory, "cards.json");
      const databases = [
        new SqliteDashboardDatabase(
          databasePath,
          legacyDashboardPath,
          legacyCardsPath,
        ),
        new SqliteDashboardDatabase(
          databasePath,
          legacyDashboardPath,
          legacyCardsPath,
        ),
      ];
      const arrive = twoPartyBarrier();
      const connections = databases.map(
        (database, index) =>
          new DatabaseAssetSourceConnections(
            database,
            memoryTransactionalSecrets(`reference-${index}`, arrive),
            Promise.resolve(),
            { now: () => new Date("2026-07-28T02:00:00.000Z") },
          ),
      );
      await Promise.all([
        connections[0].connectBinance(
          authorization("concurrent-one", credentials[0]),
        ),
        connections[1].connectBinance(
          authorization("concurrent-two", credentials[1]),
        ),
      ]);
      const sources = await databases[0].listSources();
      const cards = await databases[0].listAssetCards();
      const dailySnapshots = await databases[0].listDailyAssetSnapshots();
      return Response.json({
        accountIds: sources.map(({ accountId }) => accountId).sort(),
        cardCount: cards.length,
        dailySnapshotCount: dailySnapshots.length,
        dailySourceCount: dailySnapshots[0]?.sources.length ?? 0,
        lockContentionHandled: await exerciseSqliteLockContention(databasePath),
        rawSecretLeaked: await sqliteFilesContain(dataDirectory, credentials),
      });
    }

    if (action === "daily-idempotency") {
      const services = createProductionServices(dataDirectory);
      await services.secrets.get("startup-ready");
      const results = [
        await services.dailyAssetSnapshots.createIfAbsent(
          dailySnapshot("source-one", "10", "72"),
        ),
        await services.dailyAssetSnapshots.createIfAbsent(
          dailySnapshot("source-one", "999", "999"),
        ),
        await services.dailyAssetSnapshots.createIfAbsent(
          dailySnapshot("source-two", "20", "144"),
        ),
      ];
      const snapshots = await services.dailyAssetSnapshots.list();
      return Response.json({
        results,
        days: snapshots.map(({ day }) => day),
        sourceIds: snapshots[0].sources.map(({ sourceId }) => sourceId),
        total: snapshots[0].total,
      });
    }

    if (action === "source-lifecycle") {
      const services = createProductionServices(dataDirectory);
      await services.secrets.get("startup-ready");
      await services.assetSourceConnections.connectBinance(
        authorization("lifecycle", "lifecycle-secret"),
      );
      const [connected] = await services.assetSources.list();
      await services.assetSourceLifecycle.setHidden(connected.id, true);
      await services.assetSourceLifecycle.disconnect(connected.id);
      const [disconnectedSource] = await services.assetSources.list();
      const [disconnectedCard] = await services.assetCards.list();
      const [retainedDailySnapshot] = await services.dailyAssetSnapshots.list();
      const disconnected = {
        lifecycle: disconnectedSource.lifecycle,
        hidden: disconnectedCard.hidden,
        sourceCount: (await services.assetSources.list()).length,
        dailySourceCount: retainedDailySnapshot.sources.length,
        secretRemoved:
          (await services.secrets.get(connected.credentialReference)) === null,
      };
      await services.assetSourceLifecycle.deleteData(connected.id);
      return Response.json({
        disconnected,
        deleted: {
          sourceCount: (await services.assetSources.list()).length,
          cardCount: (await services.assetCards.list()).length,
          dailySnapshotCount: (await services.dailyAssetSnapshots.list()).length,
        },
      });
    }

    if (action === "delete-middle-source") {
      const services = createProductionServices(dataDirectory);
      await services.secrets.get("startup-ready");
      for (const accountId of ["first", "second", "third"]) {
        await services.assetSourceConnections.connectBinance(
          authorization(accountId, `${accountId}-secret`),
        );
      }
      const sources = await services.assetSources.list();
      await services.assetSourceLifecycle.deleteData(sources[1].id);
      await services.assetSourceConnections.connectBinance(
        authorization("fourth", "fourth-secret"),
      );
      return Response.json({
        accountIds: (await services.assetSources.list())
          .map(({ accountId }) => accountId)
          .sort(),
        cardCount: (await services.assetCards.list()).length,
      });
    }

    const services = createProductionServices(dataDirectory);
    await services.secrets.get("startup-ready");
    return Response.json({
      cards: await services.assetCards.list(),
      sources: await services.assetSources.list(),
      dailySnapshots: await services.dailyAssetSnapshots.list(),
      sqliteExists: await exists(path.join(dataDirectory, "dashboard.sqlite")),
      dashboardJsonExists: await exists(path.join(dataDirectory, "dashboard.json")),
    });
  } finally {
    if (previousKey === undefined) delete process.env.PAD_SECRET_ENCRYPTION_KEY;
    else process.env.PAD_SECRET_ENCRYPTION_KEY = previousKey;
    await rm(root, { recursive: true, force: true });
  }
}
