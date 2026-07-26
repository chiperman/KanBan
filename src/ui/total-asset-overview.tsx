"use client";

import { useEffect, useMemo, useState } from "react";

import { decimalToFixed } from "@/domain/decimal";
import {
  buildTotalValuation,
  type DistributionDimension,
  type ReportingCurrency,
  type ValuationSource,
} from "@/domain/valuation";

function amount(value: string): string {
  const [integer, fraction] = decimalToFixed(value, 2).split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}.${fraction}`;
}

export function TotalAssetOverview({ sources }: { sources: ValuationSource[] }) {
  const [currency, setCurrency] = useState<ReportingCurrency>("USD");
  const [dimension, setDimension] = useState<DistributionDimension>("class");

  useEffect(() => {
    const savedCurrency = window.localStorage.getItem("reporting-currency");
    if (savedCurrency === "USD" || savedCurrency === "CNY") {
      setCurrency(savedCurrency);
    }
    const savedDimension = window.localStorage.getItem("distribution-dimension");
    if (
      savedDimension === "class" ||
      savedDimension === "source" ||
      savedDimension === "currency"
    ) {
      setDimension(savedDimension);
    }
  }, []);

  const valuation = useMemo(
    () => buildTotalValuation(sources, currency, dimension),
    [currency, dimension, sources],
  );

  function changeCurrency(value: ReportingCurrency) {
    setCurrency(value);
    window.localStorage.setItem("reporting-currency", value);
  }

  function changeDimension(value: DistributionDimension) {
    setDimension(value);
    window.localStorage.setItem("distribution-dimension", value);
  }

  return (
    <section className="total-overview" data-testid="total-asset-overview">
      <div className="total-overview-head">
        <div>
          <p className="card-label">总资产概览</p>
          <p className="total-overview-amount" data-testid="total-asset-amount">
            {valuation.amount === null ? "无法折算" : amount(valuation.amount)}{" "}
            <span>{valuation.currency}</span>
          </p>
          <p className={`total-status${valuation.incomplete ? " incomplete" : ""}${valuation.expiredCount > 0 ? " expired" : ""}`}>
            {[
              valuation.incomplete
                ? `汇总不完整 · ${valuation.unvaluedCount} 项未估值`
                : "汇总完整",
              valuation.expiredCount > 0
                ? `包含 ${valuation.expiredCount} 个过期来源`
                : null,
            ].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="valuation-controls">
          <label>
            计价货币
            <select
              aria-label="计价货币"
              value={currency}
              onChange={(event) => changeCurrency(event.target.value as ReportingCurrency)}
            >
              <option value="USD">USD</option>
              <option value="CNY">CNY</option>
            </select>
          </label>
          <label>
            分布维度
            <select
              aria-label="分布维度"
              value={dimension}
              onChange={(event) => changeDimension(event.target.value as DistributionDimension)}
            >
              <option value="class">证券 / 加密资产</option>
              <option value="source">资产来源</option>
              <option value="currency">原始币种</option>
            </select>
          </label>
        </div>
      </div>
      {valuation.conversion ? (
        <p className="conversion-observation">
          汇率观察：{valuation.conversion.baseCurrency}/{valuation.conversion.quoteCurrency}{" "}
          {valuation.conversion.rate} · {valuation.conversion.source} · {valuation.conversion.observedAt.slice(0, 16).replace("T", " ")} UTC
        </p>
      ) : null}
      <div className="distribution-list" aria-label="资产分布">
        {valuation.groups.map((group) => (
          <div key={group.key} className="distribution-item">
            <span>{group.label}</span>
            <strong>
              {group.amount === null ? "未折算" : amount(group.amount)} {valuation.currency}
            </strong>
          </div>
        ))}
      </div>
    </section>
  );
}

export function TotalOverviewPlaceholder() {
  return (
    <article
      className="card span-3 restricted-card total-placeholder"
      data-testid="total-overview-placeholder"
      aria-label="受限总资产概览"
    >
      <p className="restricted-label">PRIVATE OVERVIEW</p>
      <p className="restricted-title">总资产概览已锁定</p>
      <div className="restricted-lines" aria-hidden="true"><span /><span /><span /></div>
    </article>
  );
}
