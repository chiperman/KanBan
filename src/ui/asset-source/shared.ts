import {
  initialAssetSourceFields,
  type AssetSourceFieldDescription,
  type AssetSourceFieldId,
  type AssetSourceProviderDescription,
  type AssetSourceProviderId,
} from "@/domain/asset-source-providers";
import { decimalToFixed } from "@/domain/decimal";
import type { AssetMoney, AssetPermission, BitgetAccountMode } from "@/server/ports";

export interface Preview {
  id: string;
  provider: AssetSourceProviderId;
  account: { id: string; label: string };
  permissions: AssetPermission[];
  total: AssetMoney;
  accountMode?: BitgetAccountMode;
}

export interface Reauthorization {
  sourceId: string;
  sourceLabel: string;
  provider: AssetSourceProviderId;
}

export const EVM_CHAINS = ["ethereum", "bsc"] as const;
export type EvmChain = (typeof EVM_CHAINS)[number];

export const EVM_WATCH_WALLET = {
  id: "evm" as const,
  label: "EVM 观察钱包",
  fields: [
    {
      id: "addresses" as AssetSourceFieldId,
      label: "EVM 公开地址（每行一个）",
      control: "textarea" as const,
      required: true,
    },
  ] satisfies AssetSourceFieldDescription[],
  startLabel: "验证公开地址",
  fieldHelp: "仅查公开地址，无需私钥或签名。",
};

export const MANUAL_ASSET_SOURCE = {
  id: "manual" as const,
  label: "手工记录资产",
  fields: [] satisfies AssetSourceFieldDescription[],
  fieldHelp: undefined,
};

export type ProviderSelectionId =
  | AssetSourceProviderId
  | typeof EVM_WATCH_WALLET.id
  | typeof MANUAL_ASSET_SOURCE.id;
export type FlowStep = "choose" | "configure" | "preview";

export function formatAmount(amount: string, fixed = false): string {
  const [integer, fraction] = (fixed ? decimalToFixed(amount, 2) : amount).split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export function isEvmProvider(value: ProviderSelectionId | ""): value is EvmChain | "evm" {
  return value === "evm" || value === "ethereum" || value === "bsc";
}

export function stepLabel(step: FlowStep, current: FlowStep, label: string): string {
  return step === current ? `${label}（当前步骤）` : label;
}

export type SelectedProvider =
  | AssetSourceProviderDescription
  | typeof EVM_WATCH_WALLET
  | typeof MANUAL_ASSET_SOURCE;
export type SourceFields = ReturnType<typeof initialAssetSourceFields>;
