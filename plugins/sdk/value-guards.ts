import { decimalCompare } from "@/domain/decimal";

/** 交易所返回的非负金额统一使用十进制字符串判断，避免重复实现。 */
export function positiveDecimal(value: string): boolean {
  return decimalCompare(value, "0") > 0;
}
