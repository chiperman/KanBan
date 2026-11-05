import type { AssetSnapshot } from "@/domain/assets";

/** 长桥账户总资产以账户接口原值为准，行情只更新持仓明细。 */
export function revalueLongbridgeSnapshot(snapshot: AssetSnapshot): AssetSnapshot {
  const evidence = snapshot.longbridgeValuation ?? {
    basis: "reported" as const,
    reportedTotal: snapshot.total,
    reportedAt: null,
  };
  return {
    ...snapshot,
    total: evidence.reportedTotal,
    longbridgeValuation: { ...evidence, basis: "reported" },
  };
}
