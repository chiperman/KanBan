import type {
  AssetSnapshot,
  AssetSourceKind,
  AssetSourceSyncState,
  ManualAssetClass,
  ManualAssetRecord,
} from "@/server/ports";
import type { ReportingCurrency } from "@/domain/valuation";

export interface AssetSourceView {
  id: string;
  kind: AssetSourceKind;
  label: string;
  displayName?: string;
  accountId: string;
  snapshot: AssetSnapshot;
  sync: AssetSourceSyncState;
  ignoredAssetKeys?: string[];
  includedAssetKeys?: string[];
  hasManualRecord?: boolean;
  manualAssetClass?: ManualAssetClass;
  manualRecords?: ManualAssetRecord[];
  trendHistory?: {
    currency: ReportingCurrency;
    records: Array<Pick<ManualAssetRecord, "day" | "currency"> & { amount: string | null }>;
  } | null;
  lifecycle?: "connected" | "disconnected";
}
