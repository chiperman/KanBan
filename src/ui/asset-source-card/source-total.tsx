"use client";

import type { CSSProperties } from "react";
import type { ReportingCurrency } from "@/domain/valuation";
import { VibeMetric } from "@/ui/vibe/vibe-data-instrument";
import type { AssetSourceView } from "./types";

export function AssetSourceTotal({
  source,
  sourceTotal,
  reportingCurrency,
  totalAnimationKey,
  showSensitiveInfo,
}: {
  source: AssetSourceView;
  sourceTotal: string | null;
  reportingCurrency: ReportingCurrency;
  totalAnimationKey?: string;
  showSensitiveInfo: boolean;
}) {
  const hasManualRecord = source.kind !== "manual" || source.hasManualRecord !== false;
  return (
    <>
      {hasManualRecord ? (
        <VibeMetric
          animationKey={totalAnimationKey}
          className="asset-total"
          data-testid="asset-source-total"
          style={{
            "--asset-total-value-width": `${Math.max(6, sourceTotal?.length ?? 8)}ch`,
          } as CSSProperties}
          unit={reportingCurrency}
          value={showSensitiveInfo ? sourceTotal ?? "无法折算" : "••••••"}
        />
      ) : (
        <p
          className="asset-total manual-asset-unrecorded"
          data-testid="manual-asset-unrecorded"
        >
          尚无记录
        </p>
      )}
    </>
  );
}
