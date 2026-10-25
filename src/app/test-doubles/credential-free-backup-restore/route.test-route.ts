import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  CredentialFreeBusinessDataBackup,
  type BusinessDataState,
} from "@/server/business-data-backup";

import type { AssetSourceSummary } from "@/server/ports";
import { SqliteDashboardDatabase } from "@/server/production";
import { withTestDirectory } from "@/server/testing/temporary-directory";
import { testGuard } from "@/server/testing/route-support";

export const dynamic = "force-dynamic";

function source(): AssetSourceSummary {
  return {
    id: "backup-source",
    kind: "binance",
    label: "Backup Binance",
    accountId: "backup-account",
    permissions: ["market-data", "account", "positions"] as (
      | "market-data"
      | "account"
      | "positions"
    )[],
    credentialReference: "opaque-secret-reference",
    snapshot: {
      total: { amount: "123.45", currency: "USD" },
      holdings: [],
      exchangeRates: [],
      syncedAt: "2026-07-28T02:00:00.000Z",
    },
    sync: {
      status: "current" as const,
      lastSuccessfulAt: "2026-07-28T02:00:00.000Z",
      lastAttemptAt: "2026-07-28T02:00:00.000Z",
      error: null,
    },
  };
}

function snapshot(day: string) {
  return {
    day,
    capturedAt: `${day}T02:00:00.000Z`,
    complete: true,
    total: { USD: "123.45", CNY: "888.84" },
    sources: [
      {
        sourceId: "backup-source",
        label: "Backup Binance",
        kind: "binance",
        capturedAt: `${day}T02:00:00.000Z`,
        complete: true,
        total: { USD: "123.45", CNY: "888.84" },
      },
    ],
  };
}

function trendObservation(day: string) {
  const baseline = snapshot(day);
  if (day !== "2026-07-28") return baseline;
  return {
    ...baseline,
    capturedAt: "2026-07-28T02:05:00.000Z",
    total: { USD: "130.00", CNY: "936.00" },
    sources: baseline.sources.map((source) => ({
      ...source,
      capturedAt: "2026-07-28T02:05:00.000Z",
      total: { USD: "130.00", CNY: "936.00" },
    })),
  };
}

function backupState(): BusinessDataState {
  return {
    assetCards: [
      {
        id: "backup-card",
        kind: "asset",
        title: "Binance 资产",
        body: "只读来源",
        sourceId: "backup-source",
        hidden: true,
        span: 2,
        startsNewRow: true,
      },
    ],
    assetSources: [source()],
    dailyAssetSnapshots: [snapshot("2026-07-27"), snapshot("2026-07-28")],
    dailyAssetTrendObservations: [
      trendObservation("2026-07-27"),
      trendObservation("2026-07-28"),
    ],
    importedAssetSourceHistoryObservations: [{
      day: "2026-07-20",
      sourceId: "backup-source",
      label: "Backup Binance",
      kind: "binance",
      capturedAt: "2026-07-20T02:00:00.000Z",
      complete: true,
      status: "complete",
      total: { USD: "100.00", CNY: "720.00", HKD: "780.00" },
    }],
    investmentCashflows: [],
    manualAssetRecords: [],
    formalDailySettlements: [],
  };
}

function cashflow() {
  return {
    id: "backup-initial-investment",
    kind: "initial-investment" as const,
    occurredAt: "2026-07-27T00:00:00.000Z",
    amount: "100",
    currency: "USD" as const,
    note: "备份本金",
    amounts: { USD: "100", CNY: "720", HKD: "780" },
    exchangeRates: [{
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      rate: "7.2",
      source: "Longbridge",
      observedAt: "2026-07-27T00:00:00.000Z",
    }, {
      baseCurrency: "USD",
      quoteCurrency: "HKD",
      rate: "7.8",
      source: "Longbridge",
      observedAt: "2026-07-27T00:00:00.000Z",
    }],
    createdAt: "2026-07-28T10:00:00.000Z",
    updatedAt: "2026-07-28T10:00:00.000Z",
  };
}

function updateChecksum(document: Record<string, unknown>): void {
  const checksumInput = JSON.stringify(
    document.formatVersion === 1
      ? {
          format: document.format,
          formatVersion: document.formatVersion,
          createdAt: document.createdAt,
          data: document.data,
        }
      : {
          format: document.format,
          formatVersion: document.formatVersion,
          createdAt: document.createdAt,
          payload: document.payload,
        },
  );
  document.checksum = {
    algorithm: "sha256",
    value: createHash("sha256").update(checksumInput).digest("hex"),
  };
}

export async function POST(request: Request) {
  const denied = testGuard();
  if (denied) return denied;
  const action = new URL(request.url).searchParams.get("action");
  if (
    action !== "round-trip" &&
    action !== "export-security" &&
    action !== "validation" &&
    action !== "legacy-version" &&
    action !== "v2-version" &&
    action !== "repeat-restore" &&
    action !== "rollback"
  ) {
    return Response.json({ error: "unknown action" }, { status: 400 });
  }

  return withTestDirectory("pad-backup-restore-", async (root) => {
    const database = new SqliteDashboardDatabase(path.join(root, "dashboard.sqlite"));
    const backups = new CredentialFreeBusinessDataBackup(
      database,
      path.join(root, "backups"),
      { now: () => new Date("2026-07-28T10:00:00.000Z") },
    );
    await database.replaceBusinessData(backupState());
    await database.createInvestmentCashflow(cashflow());
    const exported = await backups.exportBackup("round-trip.json");
    const backupPath = path.join(root, "backups", exported.fileName);
    if (action === "export-security") {
      const contents = await readFile(backupPath, "utf8");
      const credentialFieldPatterns = [
        "apiKey",
        "apiSecret",
        "passphrase",
        "oauthToken",
        "accessToken",
        "refreshToken",
        "codeVerifier",
        "pkce",
        "secretStore",
        "credentialReference",
        "passkey",
        "passwordHash",
        "totpSecret",
      ];
      const credentialValues = [
        "opaque-secret-reference",
        "api-key-probe",
        "oauth-token-probe",
        "pkce-probe",
        "passkey-probe",
        "password-hash-probe",
        "totp-secret-probe",
      ];
      return Response.json({
        fileMode: ((await stat(backupPath)).mode & 0o777)
          .toString(8)
          .padStart(4, "0"),
        warningIncluded: contents.includes(
          "备份仍包含敏感资产数据，请仅存放在受保护的位置。",
        ),
        credentialFieldsFound: credentialFieldPatterns.filter((field) =>
          contents.toLowerCase().includes(field.toLowerCase()),
        ),
        credentialValuesFound: credentialValues.filter((value) =>
          contents.includes(value),
        ),
      });
    }
    if (action === "validation") {
      const original = await readFile(backupPath, "utf8");
      const rejects = async (contents: string) => {
        await writeFile(backupPath, contents, { mode: 0o600 });
        try {
          await backups.previewRestore(exported.fileName);
          return false;
        } catch {
          return true;
        }
      };
      const changedDocument = () => JSON.parse(original) as Record<string, unknown>;

      const corruptJsonRejected = await rejects("{broken-json");

      const unknownVersion = changedDocument();
      unknownVersion.formatVersion = 999;
      updateChecksum(unknownVersion);
      const unknownVersionRejected = await rejects(JSON.stringify(unknownVersion));

      const checksumMismatch = changedDocument();
      const checksumPayload = checksumMismatch.payload as {
        assetSources: Array<{ label: string }>;
      };
      checksumPayload.assetSources[0].label = "tampered";
      const checksumMismatchRejected = await rejects(JSON.stringify(checksumMismatch));

      const sensitiveField = changedDocument();
      const sensitivePayload = sensitiveField.payload as {
        assetSources: Array<Record<string, unknown>>;
      };
      sensitivePayload.assetSources[0].credentials = {
        clientSecret: "forbidden-client-secret",
        sealed: "forbidden-sealed-value",
      };
      updateChecksum(sensitiveField);
      const sensitiveFieldRejected = await rejects(JSON.stringify(sensitiveField));

      const duplicateSource = changedDocument();
      const duplicatePayload = duplicateSource.payload as {
        assetSources: Array<Record<string, unknown>>;
      };
      duplicatePayload.assetSources.push({ ...duplicatePayload.assetSources[0] });
      updateChecksum(duplicateSource);
      const duplicateSourceRejected = await rejects(JSON.stringify(duplicateSource));

      const brokenReference = changedDocument();
      const brokenPayload = brokenReference.payload as {
        assetCards: Array<{ sourceId?: string }>;
      };
      brokenPayload.assetCards[0].sourceId = "missing-source";
      updateChecksum(brokenReference);
      const brokenReferenceRejected = await rejects(JSON.stringify(brokenReference));

      const cashflowEvidence = changedDocument();
      const cashflowPayload = cashflowEvidence.payload as {
        investmentCashflows: Array<{
          amounts: { CNY: string };
        }>;
      };
      cashflowPayload.investmentCashflows[0].amounts.CNY = "721";
      updateChecksum(cashflowEvidence);
      const cashflowEvidenceRejected = await rejects(
        JSON.stringify(cashflowEvidence),
      );

      const currentDataPreserved =
        (await database.listSources()).map(({ id }) => id).join(",") ===
          "backup-source" &&
        (await database.listAssetCards()).map(({ id }) => id).join(",") ===
          "backup-card";
      return Response.json({
        corruptJsonRejected,
        unknownVersionRejected,
        checksumMismatchRejected,
        sensitiveFieldRejected,
        duplicateSourceRejected,
        brokenReferenceRejected,
        cashflowEvidenceRejected,
        currentDataPreserved,
      });
    }
    if (action === "legacy-version") {
      const legacy = JSON.parse(
        await readFile(backupPath, "utf8"),
      ) as Record<string, unknown>;
      const currentPayload = legacy.payload as {
        assetCards: unknown[];
        assetSources: unknown[];
        dailyAssetSnapshots: unknown[];
      };
      legacy.formatVersion = 1;
      legacy.data = {
        cards: currentPayload.assetCards,
        sources: currentPayload.assetSources,
        snapshots: currentPayload.dailyAssetSnapshots,
      };
      delete legacy.payload;
      delete legacy.warning;
      updateChecksum(legacy);
      await writeFile(backupPath, JSON.stringify(legacy), { mode: 0o600 });
      await database.replaceBusinessData({
        assetCards: [],
        assetSources: [],
        dailyAssetSnapshots: [],
        dailyAssetTrendObservations: [],
        importedAssetSourceHistoryObservations: [],
        investmentCashflows: [],
        manualAssetRecords: [],
        formalDailySettlements: [],
      });
      await backups.restore(exported.fileName);
      const [restoredSource] = await database.listSources();
      return Response.json({
        sourceCount: (await database.listSources()).length,
        cardCount: (await database.listAssetCards()).length,
        lifecycle: restoredSource.lifecycle,
        credentialReference: restoredSource.credentialReference,
      });
    }
    if (action === "v2-version") {
      const legacy = JSON.parse(
        await readFile(backupPath, "utf8"),
      ) as Record<string, unknown>;
      const payload = legacy.payload as Record<string, unknown>;
      legacy.formatVersion = 2;
      delete payload.investmentCashflows;
      updateChecksum(legacy);
      await writeFile(backupPath, JSON.stringify(legacy), { mode: 0o600 });
      await database.replaceBusinessData({
        assetCards: [],
        assetSources: [],
        dailyAssetSnapshots: [],
        dailyAssetTrendObservations: [],
        importedAssetSourceHistoryObservations: [],
        investmentCashflows: [],
        manualAssetRecords: [],
        formalDailySettlements: [],
      });
      await backups.restore(exported.fileName);
      const [restoredSource] = await database.listSources();
      return Response.json({
        sourceCount: (await database.listSources()).length,
        cashflowCount: (await database.listInvestmentCashflows()).length,
        lifecycle: restoredSource.lifecycle,
      });
    }
    if (action === "repeat-restore") {
      await backups.restore(exported.fileName);
      await backups.restore(exported.fileName);
      const sources = await database.listSources();
      return Response.json({
        sourceCount: sources.length,
        cardCount: (await database.listAssetCards()).length,
        snapshotCount: (await database.listDailyAssetSnapshots()).length,
        sourceIds: sources.map(({ id }) => id),
      });
    }
    if (action === "rollback") {
      const incoming = JSON.parse(
        JSON.stringify(backupState())
          .replaceAll("backup-source", "incoming-source")
          .replaceAll("backup-card", "incoming-card"),
      ) as BusinessDataState;
      const failureConnection = new DatabaseSync(path.join(root, "dashboard.sqlite"));
      failureConnection.exec(`
        CREATE TRIGGER reject_restored_source
        BEFORE INSERT ON asset_sources
        BEGIN
          SELECT RAISE(ABORT, 'simulated restore failure');
        END;
      `);
      let restoreRejected = false;
      try {
        await database.replaceBusinessData(incoming);
      } catch {
        restoreRejected = true;
      } finally {
        failureConnection.exec("DROP TRIGGER reject_restored_source");
        failureConnection.close();
      }
      return Response.json({
        restoreRejected,
        currentSourceIds: (await database.listSources()).map(({ id }) => id),
        currentCardIds: (await database.listAssetCards()).map(({ id }) => id),
        currentSnapshotDays: (await database.listDailyAssetSnapshots()).map(
          ({ day }) => day,
        ),
      });
    }
    await database.replaceBusinessData({
      assetCards: [],
      assetSources: [],
      dailyAssetSnapshots: [],
      dailyAssetTrendObservations: [],
      importedAssetSourceHistoryObservations: [],
      investmentCashflows: [],
      manualAssetRecords: [],
      formalDailySettlements: [],
    });
    const preview = await backups.previewRestore(exported.fileName);
    await backups.restore(exported.fileName);
    const [restoredSource] = await database.listSources();
    const [restoredCard] = await database.listAssetCards();
    if (restoredCard === undefined) {
      throw new Error("备份恢复后缺少资产卡片");
    }
    const trendObservations = await database.listDailyAssetTrendObservations();
    const importedHistory = await database.listImportedSourceHistoryObservations();
    return Response.json({
      preview,
      restored: {
        sourceIds: (await database.listSources()).map(({ id }) => id),
        cardIds: (await database.listAssetCards()).map(({ id }) => id),
        cardLayout: {
          id: restoredCard.id,
          hidden: restoredCard.hidden ?? false,
          span: restoredCard.span,
          startsNewRow: restoredCard.startsNewRow ?? false,
        },
        snapshotDays: (await database.listDailyAssetSnapshots()).map(({ day }) => day),
        trendObservations: {
          days: trendObservations.map(({ day }) => day),
          latest: {
            capturedAt: trendObservations.at(-1)?.capturedAt,
            totalUsd: trendObservations.at(-1)?.total.USD,
          },
        },
        importedHistory: importedHistory.map((observation) => ({
          day: observation.day,
          sourceId: observation.sourceId,
          totalUsd: observation.total.USD,
        })),
        lifecycle: restoredSource.lifecycle,
        credentialReference: restoredSource.credentialReference,
        cashflows: (await database.listInvestmentCashflows()).map((item) => ({
          kind: item.kind,
          occurredAt: item.occurredAt,
          amount: item.amount,
          currency: item.currency,
          amounts: item.amounts,
          exchangeRateSources: item.exchangeRates.map(({ source }) => source),
        })),
      },
    });
  });
}
