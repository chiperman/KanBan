import type {
  AssetSnapshot,
  AssetSourceSyncState,
  ManualAssetClass,
  ManualAssetRecord,
} from "@/server/ports";

export interface AssetSourceView {
  id: string;
  kind: string;
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
  lifecycle?: "connected" | "disconnected";
}
