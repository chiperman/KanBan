import { createJsonDecoder } from "../../sdk/json";
import type { AssetPermission, BitgetAccountMode } from "@/server/ports";

const { record, list, text, identifier } = createJsonDecoder("Bitget");
const READ_ONLY_AUTHORITIES = new Set([
  "coor",
  "cpor",
  "stor",
  "smor",
  "ttor",
  "wtor",
  "taxr",
  "chor",
  "p2pr",
  "pllr",
]);

export interface BitgetIdentity {
  permissions: AssetPermission[];
  userId: string;
  parentId: string;
  accountMode: BitgetAccountMode;
  scope: string[];
  registeredAt: string;
}

function optionalParentId(value: unknown): string {
  if (value === "") return "";
  return identifier(value, "parentId");
}

export function validateBitgetReadOnlyPermission(value: unknown): AssetPermission[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Bitget 无法证明只读权限");
  }
  const tokens = value.map((item) => text(item, "authorities"));
  const unique = new Set(tokens);
  if (
    unique.size !== tokens.length ||
    tokens.some((authority) => !READ_ONLY_AUTHORITIES.has(authority))
  ) {
    throw new Error("检测到 Bitget 写权限或未知权限，已拒绝连接");
  }
  return ["market-data", "account", "positions"];
}

function registrationTime(value: unknown): string {
  const timestamp = text(value, "regisTime");
  if (!/^\d+$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp))) {
    throw new Error("Bitget regisTime 格式无效");
  }
  return timestamp;
}

export function responseTime(value: unknown): string {
  const milliseconds = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/.test(value)
      ? Number(value)
      : Number.NaN;
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new Error("Bitget requestTime 格式无效");
  }
  return new Date(milliseconds).toISOString();
}

export function validateClassicAccountInfo(value: unknown): BitgetIdentity {
  const config = record(value, "Bitget spot/account/info data");
  const permissions = validateBitgetReadOnlyPermission(config.authorities);
  const scope = (config.authorities as string[]).slice().sort();
  return {
    permissions,
    userId: identifier(config.userId, "userId"),
    parentId: optionalParentId(config.parentId),
    accountMode: "classic",
    scope,
    registeredAt: registrationTime(config.regisTime),
  };
}

export function validateBitgetUtaReadOnlyPermission(
  permType: unknown,
  permissions: unknown,
): AssetPermission[] {
  if (permType !== "read-only" || !Array.isArray(permissions)) {
    throw new Error("Bitget UTA 无法证明 read-only 权限");
  }
  const values = permissions.map((item) => text(item, "permissions"));
  const unique = new Set(values);
  if (
    unique.size !== values.length ||
    unique.size !== 2 ||
    !unique.has("uta_mgt") ||
    !unique.has("uta_trade")
  ) {
    throw new Error("Bitget UTA 权限范围不是纯只读资产范围，已拒绝连接");
  }
  return ["market-data", "account", "positions"];
}

export function validateUtaAccountInfo(value: unknown): BitgetIdentity {
  const config = record(value, "Bitget UTA account/info data");
  const permissions = validateBitgetUtaReadOnlyPermission(
    config.permType,
    config.permissions,
  );
  const scope = (config.permissions as string[]).slice().sort();
  return {
    permissions,
    userId: identifier(config.userId, "userId"),
    parentId: optionalParentId(config.parentId),
    accountMode: "uta",
    scope,
    registeredAt: registrationTime(config.regisTime),
  };
}
