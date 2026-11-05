import { randomUUID } from "node:crypto";

import {
  assertInvestmentCashflowSequence,
  normalizeInvestmentCashflowInput,
  valueInvestmentCashflow,
} from "@/domain/investment-performance";
import type {
  AssetSources,
  Clock,
  InvestmentCashflow,
  InvestmentCashflowInput,
  InvestmentCashflowUpdate,
  InvestmentCashflows,
} from "@/server/ports";

export interface InvestmentCashflowStore {
  listInvestmentCashflows(): Promise<InvestmentCashflow[]>;
  createInvestmentCashflow(cashflow: InvestmentCashflow): Promise<void>;
  updateInvestmentCashflow(cashflow: InvestmentCashflow): Promise<void>;
  deleteInvestmentCashflow(id: string): Promise<void>;
}

function assertNotFuture(occurredAt: string, now: Date): void {
  if (new Date(occurredAt).valueOf() > now.valueOf()) {
    throw new Error("资金发生时间不能晚于当前时间");
  }
}

/**
 * 账本服务只处理本金事实与换算证据。它不会创建、修改或回填任何资产观测，
 * 以避免历史补录被误写成历史净值。
 */
export class InvestmentCashflowLedger implements InvestmentCashflows {
  constructor(
    private readonly store: InvestmentCashflowStore,
    private readonly assetSources: Pick<AssetSources, "list">,
    private readonly clock: Clock,
  ) {}

  async list(): Promise<InvestmentCashflow[]> {
    return (await this.store.listInvestmentCashflows()).toSorted(
      (left, right) =>
        right.occurredAt.localeCompare(left.occurredAt) ||
        right.createdAt.localeCompare(left.createdAt) ||
        right.id.localeCompare(left.id),
    );
  }

  async create(input: InvestmentCashflowInput): Promise<InvestmentCashflow> {
    const normalized = normalizeInvestmentCashflowInput(input);
    const now = this.clock.now();
    assertNotFuture(normalized.occurredAt, now);
    const valuation = valueInvestmentCashflow(
      normalized,
      await this.assetSources.list(),
    );
    const cashflow: InvestmentCashflow = {
      id: randomUUID(),
      ...normalized,
      ...valuation,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    const existing = await this.store.listInvestmentCashflows();
    assertInvestmentCashflowSequence([...existing, cashflow]);
    await this.store.createInvestmentCashflow(cashflow);
    return cashflow;
  }

  async update(
    id: string,
    update: InvestmentCashflowUpdate,
  ): Promise<InvestmentCashflow> {
    const existing = (await this.store.listInvestmentCashflows()).find(
      (cashflow) => cashflow.id === id,
    );
    if (!existing) throw new Error("资金记录不存在");
    const normalized = normalizeInvestmentCashflowInput({
      kind: update.kind ?? existing.kind,
      occurredAt: update.occurredAt ?? existing.occurredAt,
      amount: update.amount ?? existing.amount,
      currency: update.currency ?? existing.currency,
      note: update.note === undefined ? existing.note : update.note,
    });
    const now = this.clock.now();
    assertNotFuture(normalized.occurredAt, now);
    const amountOrCurrencyChanged =
      normalized.amount !== existing.amount ||
      normalized.currency !== existing.currency;
    const valuation = amountOrCurrencyChanged
      ? valueInvestmentCashflow(normalized, await this.assetSources.list())
      : {
          amounts: existing.amounts,
          exchangeRates: existing.exchangeRates,
        };
    const cashflow: InvestmentCashflow = {
      ...existing,
      ...normalized,
      ...valuation,
      updatedAt: now.toISOString(),
    };
    const all = await this.store.listInvestmentCashflows();
    assertInvestmentCashflowSequence(
      all.map((item) => (item.id === id ? cashflow : item)),
    );
    await this.store.updateInvestmentCashflow(cashflow);
    return cashflow;
  }

  async delete(id: string): Promise<void> {
    const exists = (await this.store.listInvestmentCashflows()).some(
      (cashflow) => cashflow.id === id,
    );
    if (!exists) throw new Error("资金记录不存在");
    await this.store.deleteInvestmentCashflow(id);
  }
}
