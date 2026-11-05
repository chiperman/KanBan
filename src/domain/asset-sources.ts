import type { AssetSourceKind } from "@/domain/asset-source-kinds";
import type { InvestmentBookId } from "@/domain/source-investment-book";
import type { AssetPermission, AssetSnapshot, ManualAssetClass } from "@/domain/assets";
import type { AssetSourceSyncState } from "@/domain/asset-sync";

/** 外部资产来源的持久化摘要；凭证正文永不进入这个接口。 */
export interface AssetSourceSummary {
  id: string;
  kind: AssetSourceKind;
  /** 持久化业务归属；null 为未归属。缺省仅供旧来源迁移，不依赖插件安装状态。 */
  investmentBookId?: InvestmentBookId | null;
  label: string;
  /** 所有者设置的可选展示名；缺省时使用平台默认名称。 */
  displayName?: string;
  accountId: string;
  permissions: AssetPermission[];
  /** 断开来源可不再持有任何凭证引用；连接来源必须为非空引用。 */
  credentialReference: string | null;
  snapshot: AssetSnapshot;
  sync: AssetSourceSyncState;
  /** 所有者按 EVM chain ID + 原生币或合约资产标识明确忽略的来源资产。 */
  ignoredAssetKeys?: string[];
  /** 所有者确认属于投资资产、即使暂时缺价也应正常展示的 EVM 资产标识。 */
  includedAssetKeys?: string[];
  /** 手工来源创建后尚未添加首条数据时为 false；不得将占位快照计入资产。 */
  hasManualRecord?: boolean;
  /** 手工来源在资产类别分布中的归类；旧数据缺省为待分类。 */
  manualAssetClass?: ManualAssetClass;
  /** 旧数据缺省为 connected；断开后仅保留历史身份与快照。 */
  lifecycle?: "connected" | "disconnected";
}
