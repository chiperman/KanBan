import { InvalidInvestmentBookError, isBookValuationConflict, type BookValuationConflict, type BookValuationChoice } from "@/domain/investment-books";
import { InvalidManualAssetRecordError } from "@/domain/manual-asset-records";
import { InvalidSourceInvestmentHistoryError } from "@/domain/source-investment-history";
import { InvalidSourceInvestmentRecordError } from "@/domain/source-investment-records";

export class InvestmentBookCommandError extends Error {}

export class InvestmentBookValuationConflict extends InvestmentBookCommandError {
  constructor(readonly conflicts: BookValuationConflict[]) {
    super("同一天有不同的资产金额，请选择采用哪一条。");
  }
}

/** 常驻账本服务可跨热更新复用，接口按冲突合同识别，避免 instanceof 将其误报为 500。 */
export function isInvestmentBookValuationConflict(error: unknown): error is InvestmentBookValuationConflict {
  return error instanceof Error && "conflicts" in error && Array.isArray(error.conflicts) &&
    error.conflicts.length > 0 && error.conflicts.every(isBookValuationConflict);
}

/** 选择绑定本次核对的记录与金额；过期选择不能覆盖后来保存的数据。 */
export function requireValuationChoices(
  conflicts: BookValuationConflict[],
  value: unknown,
): Map<string, BookValuationChoice["choice"]> {
  const choices = new Map<string, BookValuationChoice["choice"]>();
  if (value !== undefined) {
    if (!Array.isArray(value)) throw new InvestmentBookCommandError("资产金额选择无效");
    for (const row of value) {
      if (!row || typeof row !== "object" || typeof row.key !== "string" ||
          (row.choice !== "existing" && row.choice !== "incoming") || choices.has(row.key)) {
        throw new InvestmentBookCommandError("资产金额选择无效");
      }
      choices.set(row.key, row.choice);
    }
  }
  if (conflicts.some(conflict => !choices.has(conflict.key))) {
    throw new InvestmentBookValuationConflict(conflicts);
  }
  return choices;
}

/** 仅包裹写入前的纯校验；读取、迁移和持久化异常必须保留为未知执行结果。 */
export function parseInvestmentBookCommandInput<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (
      error instanceof InvalidInvestmentBookError ||
      error instanceof InvalidManualAssetRecordError ||
      error instanceof InvalidSourceInvestmentHistoryError ||
      error instanceof InvalidSourceInvestmentRecordError
    ) {
      throw new InvestmentBookCommandError(error.message, { cause: error });
    }
    throw error;
  }
}
