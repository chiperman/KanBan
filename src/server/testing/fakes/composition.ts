import type {
  FormalDailySettlementRunner,
  FormalSettlementExecution,
  FormalSettlementSchedulerStatus,
} from "@/server/ports";
import type { AppServices } from "@/server/app-services";
import { SessionOwnerAuth } from "@/server/auth/session-auth";
import { SourceIsolatedAssetSynchronization } from "@/server/refresh/asset-synchronization";
import { LongbridgeOAuthState } from "@/server/asset-source-plugins/oauth-state";
import { AssetSourceOnboarding } from "@/server/asset-source-onboarding";
import { createAssetSourceProviderAdapters } from "@/server/asset-source-provider-adapters";
import { InvestmentCashflowLedger } from "@/server/investment-cashflows";
import {
  FakeAssetSources,
  InMemoryAssetCardStore,
  InMemoryDailyAssetSnapshots,
  InMemoryAssetFullRefreshState,
  InMemoryFormalDailySettlements,
  InMemoryInvestmentCashflowStore,
  InMemoryManualAssetRecords,
  NotDueFormalDailySettlementRunner,
} from "./stores";
import { FakeClock } from "./clock";
import {
  FakeBinanceReadOnly,
  FakeBitReadOnly,
  FakeBitgetReadOnly,
  FakeEvmWatchWallet,
  FakeOkxReadOnly,
} from "./providers";
import {
  FakeLongbridgeBenchmarkCandlestickReader,
  FakeLongbridgeHoldingCandlestickReader,
  FakeLongbridgeOAuth,
} from "./longbridge";
import { FakePrices } from "./prices";
import {
  InMemoryOwnerCredentialStore,
  InMemoryOwnerRecoveryCredentialStore,
  InMemorySecretStore,
} from "./credentials";
import { InMemoryExternalServiceConfiguration } from "./external-services";
import { InMemoryAssetSourceConnections, InMemoryAssetSourceLifecycle } from "./connections";
import { InMemoryAssetSourceDetails, InMemoryInvestmentBooks } from "./investments";

export interface TestServices extends AppServices {
  clock: FakeClock;
  assetCards: InMemoryAssetCardStore;
  assetSources: FakeAssetSources;
  dailyAssetSnapshots: InMemoryDailyAssetSnapshots;
  formalDailySettlements: InMemoryFormalDailySettlements;
  formalDailySettlementRunner: FormalDailySettlementRunner;
  formalSettlementExecutions: InMemoryFormalSettlementExecutions;
  formalSettlementScheduler: InMemoryFormalSettlementScheduler;
  externalServices: InMemoryExternalServiceConfiguration;
  assetSynchronization: SourceIsolatedAssetSynchronization;
  assetFullRefreshState: InMemoryAssetFullRefreshState;
  prices: FakePrices;
  auth: SessionOwnerAuth;
  ownerCredentials: InMemoryOwnerCredentialStore;
  ownerRecoveryCredentials: InMemoryOwnerRecoveryCredentialStore;
  secrets: InMemorySecretStore;
  longbridge: FakeLongbridgeOAuth;
  longbridgeBenchmarkCandlesticks: FakeLongbridgeBenchmarkCandlestickReader;
  longbridgeHoldingCandlesticks: FakeLongbridgeHoldingCandlestickReader;
  longbridgeOAuthState: LongbridgeOAuthState;
  binance: FakeBinanceReadOnly;
  okx: FakeOkxReadOnly;
  bitget: FakeBitgetReadOnly;
  bit: FakeBitReadOnly;
  evm: FakeEvmWatchWallet;
  assetSourceConnections: InMemoryAssetSourceConnections;
  manualAssetRecords: InMemoryManualAssetRecords;
  investmentCashflows: InvestmentCashflowLedger;
  assetSourceOnboarding: AssetSourceOnboarding;
  assetSourceLifecycle: InMemoryAssetSourceLifecycle;
}

export function createTestServices(): TestServices {
  const clock = new FakeClock();
  const assetCards = new InMemoryAssetCardStore();
  const assetSources = new FakeAssetSources();
  const investmentCashflowStore = new InMemoryInvestmentCashflowStore();
  const investmentCashflows = new InvestmentCashflowLedger(
    investmentCashflowStore,
    assetSources,
    clock,
  );
  const dailyAssetSnapshots = new InMemoryDailyAssetSnapshots();
  const fullRefreshState = new InMemoryAssetFullRefreshState();
  const formalDailySettlements = new InMemoryFormalDailySettlements();
  const secrets = new InMemorySecretStore();
  const externalServices = new InMemoryExternalServiceConfiguration(clock);
  const prices = new FakePrices();
  const assetSynchronization = new SourceIsolatedAssetSynchronization(
    assetSources,
    secrets,
    clock,
    { refresh: async ({ source }) => ({ snapshot: source.snapshot }) },
    100,
    dailyAssetSnapshots,
    fullRefreshState,
  );
  const assetSourceLifecycle = new InMemoryAssetSourceLifecycle(
    assetSources,
    assetCards,
    secrets,
    dailyAssetSnapshots,
    fullRefreshState,
  );
  const longbridge = new FakeLongbridgeOAuth();
  const longbridgeBenchmarkCandlesticks = new FakeLongbridgeBenchmarkCandlestickReader();
  const longbridgeHoldingCandlesticks = new FakeLongbridgeHoldingCandlestickReader();
  const binance = new FakeBinanceReadOnly(prices);
  const okx = new FakeOkxReadOnly();
  const bitget = new FakeBitgetReadOnly();
  const bit = new FakeBitReadOnly();
  const evm = new FakeEvmWatchWallet();
  const assetSourceConnections = new InMemoryAssetSourceConnections(
    assetSources,
    assetCards,
    secrets,
    dailyAssetSnapshots,
    clock,
    fullRefreshState,
  );
  const manualAssetRecords = new InMemoryManualAssetRecords(
    assetSources,
    assetCards,
    dailyAssetSnapshots,
    clock,
  );
  const assetSourceDetails = new InMemoryAssetSourceDetails(assetSources, manualAssetRecords, dailyAssetSnapshots);
  const investmentBooks = new InMemoryInvestmentBooks(assetSources, investmentCashflows, assetSourceDetails);
  const assetSourceOnboarding = new AssetSourceOnboarding(
    createAssetSourceProviderAdapters({
      longbridge,
      binance,
      okx,
      bitget,
      bit,
      evm,
      connections: assetSourceConnections,
    }),
  );
  let exportedBackupFileName: string | null = null;
  const backupPreview = async () => {
    const [sources, cards, snapshots] = await Promise.all([
      assetSources.list(),
      assetCards.list(),
      dailyAssetSnapshots.list(),
    ]);
    const days = snapshots.map(({ day }) => day).sort();
    return {
      sourceCount: sources.length,
      cardCount: cards.length,
      snapshotRange: {
        from: days[0] ?? null,
        to: days.at(-1) ?? null,
      },
      replaces: {
        sourceCount: sources.length,
        cardCount: cards.length,
        snapshotCount: snapshots.length,
      },
      warning: "备份仍包含敏感资产数据，请仅存放在受保护的位置。",
    };
  };
  return {
    clock,
    assetCards,
    assetSources,
    assetSourceDetails,
    investmentBooks,
    manualAssetRecords,
    investmentCashflows,
    assetSourceLifecycle,
    dailyAssetSnapshots,
    formalDailySettlements,
    formalDailySettlementRunner: new NotDueFormalDailySettlementRunner(),
    formalSettlementExecutions: new InMemoryFormalSettlementExecutions(),
    formalSettlementScheduler: new InMemoryFormalSettlementScheduler(),
    externalServices,
    assetSynchronization,
    assetFullRefreshState: fullRefreshState,
    prices,
    auth: new SessionOwnerAuth(clock),
    ownerCredentials: new InMemoryOwnerCredentialStore(),
    ownerRecoveryCredentials: new InMemoryOwnerRecoveryCredentialStore(),
    secrets,
    longbridge,
    longbridgeBenchmarkCandlesticks,
    longbridgeHoldingCandlesticks,
    longbridgeOAuthState: new LongbridgeOAuthState(),
    binance,
    okx,
    bitget,
    bit,
    evm,
    assetSourceConnections,
    assetSourceOnboarding,
    businessDataBackups: {
      async listBackups() {
        return exportedBackupFileName === null
          ? []
          : [{
            fileName: exportedBackupFileName,
            modifiedAt: null,
            size: 0,
          }];
      },
      async importBackup() {
        throw new Error("测试环境不支持上传备份");
      },
      async exportBackup() {
        exportedBackupFileName = "asset-dashboard-test-backup.json";
        return {
          fileName: exportedBackupFileName,
          checksum: "test-only-checksum",
          warning: "备份仍包含敏感资产数据，请仅存放在受保护的位置。",
        };
      },
      async previewRestore(fileName: string) {
        if (fileName !== exportedBackupFileName) {
          throw new Error("本机备份文件不存在");
        }
        return backupPreview();
      },
      async restore(fileName: string) {
        if (fileName !== exportedBackupFileName) {
          throw new Error("本机备份文件不存在");
        }
        return backupPreview();
      },
    },
  };
}

export class InMemoryFormalSettlementExecutions {
  private value: FormalSettlementExecution | null = null;
  async latest() { return this.value ? structuredClone(this.value) : null; }
  async record(value: FormalSettlementExecution) {
    if (!this.value || value.startedAt >= this.value.startedAt) this.value = structuredClone(value);
  }
}
export class InMemoryFormalSettlementScheduler {
  state: FormalSettlementSchedulerStatus["state"] = "unsupported";
  async read(): Promise<FormalSettlementSchedulerStatus> {
    return { state: this.state, checkedAt: "2026-09-18T00:00:00.000Z" };
  }
}
