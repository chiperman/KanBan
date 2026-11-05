import { InvalidInvestmentBookError } from "@/domain/investment-books";
import { InvalidManualAssetRecordError } from "@/domain/manual-asset-records";
import { InvalidSourceInvestmentHistoryError } from "@/domain/source-investment-history";
import { InvalidSourceInvestmentRecordError } from "@/domain/source-investment-records";

export class InvestmentBookCommandError extends Error {}

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
