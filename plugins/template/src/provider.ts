import type { AssetSnapshot } from "@/domain/assets";
import type { AssetSourcePluginAuthorization } from "../../sdk/protocol";

/** Replace these functions with the provider's read-only API integration. */
export async function readSnapshot(
  _credentials: Record<string, unknown>,
  _observedAt: string,
  _signal: AbortSignal,
): Promise<AssetSnapshot> {
  throw new Error("请先实现供应商 API 读取和快照映射");
}

export async function createAuthorization(
  _input: Record<string, unknown>,
  _observedAt: string,
  _signal: AbortSignal,
): Promise<AssetSourcePluginAuthorization> {
  throw new Error("请实现账户身份、只读权限校验与授权结果");
}
