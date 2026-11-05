import { createJsonDecoder } from "../../sdk/json";
import type { AssetPermission, OkxRegion } from "@/server/ports";
import { first } from "./okx-json";

const { list, text } = createJsonDecoder("OKX");

export function region(value: unknown): OkxRegion {
  if (value === undefined) return "global";
  if (value === "global" || value === "us" || value === "eea") return value;
  throw new Error("OKX 注册区域无效");
}

export function validateOkxReadOnlyPermission(value: unknown): AssetPermission[] {
  if (typeof value !== "string") {
    throw new Error("OKX 无法证明只读权限");
  }
  const tokens = value.split(",").map((item) => item.trim());
  const unique = new Set(tokens);
  if (
    tokens.length !== 1 ||
    unique.size !== tokens.length ||
    tokens[0] !== "read_only"
  ) {
    throw new Error("检测到 OKX 非只读权限，已拒绝连接");
  }
  return ["market-data", "account", "positions"];
}

export function validateAccountConfig(value: unknown): {
  permissions: AssetPermission[];
  uid: string;
  mainUid: string;
  type: string;
} {
  const config = first(value, "OKX account/config data");
  const permissions = validateOkxReadOnlyPermission(config.perm);
  if (config.acctLv !== "1") {
    throw new Error("OKX 仅接受 Spot mode 账户");
  }
  for (const field of [
    "enableSpotBorrow",
    "spotBorrowAutoRepay",
    "autoLoan",
  ] as const) {
    if (config[field] !== false) {
      throw new Error(`OKX ${field} 未明确关闭，已拒绝连接`);
    }
  }
  return {
    permissions,
    uid: text(config.uid, "uid"),
    mainUid: text(config.mainUid, "mainUid"),
    type: text(config.type, "type"),
  };
}

export function validateNoOptions(value: unknown): void {
  if (list(value, "OKX OPTION positions data").length !== 0) {
    throw new Error("OKX 账户存在 Option 持仓，已拒绝连接");
  }
}
