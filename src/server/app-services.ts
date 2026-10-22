import type { LongbridgeConnections } from "@/server/asset-sources/longbridge-connections";
import type { BackgroundAssetCollection } from "@/server/background-collection";
import type {
  AssetCardStore,
  AssetFullRefreshState,
  AssetSourceConnections,
  AssetSourceDetails,
  AssetSourceLifecycle,
  AssetSources,
  AssetSynchronization,
  BinanceReadOnly,
  BitgetReadOnly,
  BitReadOnly,
  Clock,
  DailyAssetSnapshots,
  EvmWatchWalletReadOnly,
  ExternalServiceConfiguration,
  FormalDailySettlementRunner,
  FormalDailySettlements,
  FormalSettlementExecutions,
  FormalSettlementScheduler,
  InvestmentCashflows,
  LongbridgeBenchmarkCandlestickReader,
  LongbridgeHoldingCandlestickReader,
  LongbridgeOAuth,
  ManualAssetRecords,
  OkxReadOnly,
  OwnerAuth,
  OwnerCredentialStore,
  OwnerRecoveryCredentialStore,
  Prices,
  SecretStore,
} from "@/server/ports";
import type { AssetSourceOnboarding } from "@/server/asset-source-onboarding";
import type { LongbridgeOAuthState } from "@/server/asset-sources/longbridge";
import type { BusinessDataBackup } from "@/server/business-data-backup";
import type { InvestmentBookStore } from "@/domain/investment-books";

export interface AssetServices {
  investmentBooks?: InvestmentBookStore;
  assetCards: AssetCardStore;
  assetSources: AssetSources;
  /** 测试替身可省略详情能力；提供时必须包含完整的查询和记账接口。 */
  assetSourceDetails?: AssetSourceDetails;
  assetSourceLifecycle: AssetSourceLifecycle;
  assetSourceConnections: AssetSourceConnections;
  manualAssetRecords: ManualAssetRecords;
  investmentCashflows: InvestmentCashflows;
  assetSourceOnboarding: AssetSourceOnboarding;
}

export interface AssetObservationServices {
  backgroundCollection?: BackgroundAssetCollection;
  assetSynchronization: AssetSynchronization;
  assetFullRefreshState: AssetFullRefreshState;
  dailyAssetSnapshots: DailyAssetSnapshots;
  formalDailySettlements: FormalDailySettlements;
  formalDailySettlementRunner: FormalDailySettlementRunner;
  formalSettlementExecutions: FormalSettlementExecutions;
  formalSettlementScheduler: FormalSettlementScheduler;
}

export interface MarketServices {
  longbridgeConnections?: LongbridgeConnections;
  prices: Prices;
  longbridge: LongbridgeOAuth;
  longbridgeBenchmarkCandlesticks: LongbridgeBenchmarkCandlestickReader;
  longbridgeHoldingCandlesticks: LongbridgeHoldingCandlestickReader;
  longbridgeOAuthState: LongbridgeOAuthState;
  binance: BinanceReadOnly;
  okx: OkxReadOnly;
  bitget: BitgetReadOnly;
  bit: BitReadOnly;
  evm: EvmWatchWalletReadOnly;
}

export interface OwnerServices {
  auth: OwnerAuth;
  ownerCredentials: OwnerCredentialStore;
  ownerRecoveryCredentials: OwnerRecoveryCredentialStore;
  secrets: SecretStore;
}

export interface AppServices extends
  AssetServices,
  AssetObservationServices,
  MarketServices,
  OwnerServices {
  clock: Clock;
  externalServices: ExternalServiceConfiguration;
  businessDataBackups: BusinessDataBackup;
}

export interface ProductionAppServices extends AppServices {
  backgroundCollection: BackgroundAssetCollection;
  investmentBooks: InvestmentBookStore;
  assetSourceDetails: AssetSourceDetails;
}
