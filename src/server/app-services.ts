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
import type { LongbridgeOAuthState } from "@/server/asset-source-plugins/oauth-state";
import type { BusinessDataBackup } from "@/server/backup/business-data-backup";
import type { InvestmentBookStore } from "@/domain/investment-books";

export interface AssetServices {
  pluginManagement?: import("@/server/asset-source-plugins/distribution").PluginDistribution;
  assetSourcePlugins?: import("@/server/asset-source-plugins/manager").AssetSourcePluginManager;
  investmentBooks: InvestmentBookStore;
  assetCards: AssetCardStore;
  assetSources: AssetSources;
  assetSourceDetails: AssetSourceDetails;
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
  longbridgeConnections?: Pick<LongbridgeConnections, "status" | "checkCli" | "loginCli" | "subscribeQuotes" | "finishConnection" | "previewConnection">;
  prices: Prices;
  longbridge: LongbridgeOAuth;
  longbridgeBenchmarkCandlesticks: LongbridgeBenchmarkCandlestickReader;
  longbridgeHoldingCandlesticks: LongbridgeHoldingCandlestickReader;
  longbridgeOAuthState: LongbridgeOAuthState;
  binance?: BinanceReadOnly;
  okx?: OkxReadOnly;
  bitget?: BitgetReadOnly;
  bit?: BitReadOnly;
  evm?: EvmWatchWalletReadOnly;
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
  pluginManagement: import("@/server/asset-source-plugins/distribution").PluginDistribution;
  backgroundCollection: BackgroundAssetCollection;
}
