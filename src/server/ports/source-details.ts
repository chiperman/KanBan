import type { SourceInvestmentHistory } from "@/domain/source-investment-history";
import type {
  SourceInvestmentRecord,
  SourceInvestmentRecordInput,
} from "@/domain/source-investment-records";
import type { DailyAssetTrendObservation } from "./history";
import type { AssetSourceSummary, ManualAssetRecord } from "./sources";

export interface AssetSourceDetailQuery {
  sourceId: string;
  from?: string;
  to?: string;
}

export interface AssetSourceDetailResult {
  sources: AssetSourceSummary[];
  manualRecords: ManualAssetRecord[];
  history: DailyAssetTrendObservation[];
  firstDay?: string;
  investmentHistory?: SourceInvestmentHistory | null;
  investmentRecords: SourceInvestmentRecord[];
}

export interface AssetSourceDetails {
  readSourceDetail(query: AssetSourceDetailQuery): Promise<AssetSourceDetailResult>;
  listSourceInvestmentHistories(): Promise<SourceInvestmentHistory[]>;
  listSourceInvestmentRecords(sourceId?: string): Promise<SourceInvestmentRecord[]>;
  saveSourceInvestmentRecord(
    sourceId: string,
    input: SourceInvestmentRecordInput,
    capturedAt: string,
  ): Promise<void>;
  deleteSourceInvestmentRecord(sourceId: string, id: string): Promise<void>;
}
