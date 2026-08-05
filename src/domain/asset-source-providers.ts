import type { BitgetAccountMode } from "@/server/ports";

export type AssetSourceProviderId =
  | "longbridge"
  | "binance"
  | "okx"
  | "bitget"
  | "bit"
  | "ethereum"
  | "bsc";

export type AssetSourceFieldId =
  | "apiKey"
  | "apiSecret"
  | "passphrase"
  | "userId"
  | "region"
  | "accountMode"
  | "addresses";

interface AssetSourceFieldOption {
  value: string;
  label: string;
}

export interface AssetSourceFieldDescription {
  id: AssetSourceFieldId;
  label: string;
  control: "text" | "password" | "textarea" | "select";
  required: true;
  defaultValue?: string;
  options?: AssetSourceFieldOption[];
}

export interface AssetSourceProviderDescription {
  id: AssetSourceProviderId;
  label: string;
  route: "longbridge" | "binance" | "okx" | "bitget" | "bit" | "evm";
  authorization: "oauth" | "credentials" | "public-addresses";
  fields: AssetSourceFieldDescription[];
  startLabel: string;
  validationError: string;
  dialogLabel: string;
  previewTitle: string;
  previewScope(accountMode?: BitgetAccountMode): string;
  savedMaterial: string;
  fieldHelp?: string;
}

const API_KEY = (provider: string): AssetSourceFieldDescription => ({
  id: "apiKey",
  label: `${provider} API Key`,
  control: "text",
  required: true,
});

const API_SECRET = (provider: string): AssetSourceFieldDescription => ({
  id: "apiSecret",
  label: `${provider} API Secret`,
  control: "password",
  required: true,
});

const PASSPHRASE = (provider: string): AssetSourceFieldDescription => ({
  id: "passphrase",
  label: `${provider} Passphrase`,
  control: "password",
  required: true,
});

export const ASSET_SOURCE_PROVIDERS: AssetSourceProviderDescription[] = [
  {
    id: "longbridge",
    label: "长桥 Longbridge",
    route: "longbridge",
    authorization: "oauth",
    fields: [],
    startLabel: "开始 OAuth 授权",
    validationError: "无法开始长桥授权",
    dialogLabel: "确认长桥资产来源",
    previewTitle: "长桥授权预览",
    previewScope: () => "账户、持仓（只读）",
    savedMaterial: " OAuth 凭证",
  },
  {
    id: "binance",
    label: "Binance",
    route: "binance",
    authorization: "credentials",
    fields: [API_KEY("Binance"), API_SECRET("Binance")],
    startLabel: "验证只读凭证",
    validationError: "Binance 凭证验证失败",
    dialogLabel: "确认 Binance 资产来源",
    previewTitle: "Binance 凭证预览",
    previewScope: () => "现货、资金、Simple Earn（只读）",
    savedMaterial: "只读 API 凭证",
  },
  {
    id: "okx",
    label: "OKX",
    route: "okx",
    authorization: "credentials",
    fields: [
      {
        id: "region",
        label: "OKX 注册区域",
        control: "select",
        required: true,
        defaultValue: "global",
        options: [
          { value: "global", label: "Global" },
          { value: "us", label: "US / AU" },
          { value: "eea", label: "EEA" },
        ],
      },
      API_KEY("OKX"),
      API_SECRET("OKX"),
      PASSPHRASE("OKX"),
    ],
    startLabel: "验证只读凭证",
    validationError: "OKX 凭证验证失败",
    dialogLabel: "确认 OKX 资产来源",
    previewTitle: "OKX 凭证预览",
    previewScope: () => "现货、资金、Simple Earn、On-chain Earn（只读）",
    savedMaterial: "只读 API 凭证",
  },
  {
    id: "bitget",
    label: "Bitget",
    route: "bitget",
    authorization: "credentials",
    fields: [
      {
        id: "accountMode",
        label: "Bitget 账户类型",
        control: "select",
        required: true,
        defaultValue: "classic",
        options: [
          { value: "classic", label: "Classic Account" },
          { value: "uta", label: "Unified Trading Account (UTA)" },
        ],
      },
      API_KEY("Bitget"),
      API_SECRET("Bitget"),
      PASSPHRASE("Bitget"),
    ],
    startLabel: "验证只读凭证",
    validationError: "Bitget 凭证验证失败",
    dialogLabel: "确认 Bitget 资产来源",
    previewTitle: "Bitget 凭证预览",
    previewScope: (accountMode) =>
      accountMode === "uta"
        ? "UTA 纯现金 · 现货、资金、Savings、SharkFin、On-chain Elite（只读）"
        : "Classic Account · 现货、资金、Savings、SharkFin、On-chain Elite、普通 Futures（平台总额已含，不展开仓位）、合约交易机器人（只读）",
    savedMaterial: "只读 API 凭证",
  },
  {
    id: "bit",
    label: "BIT / Matrixport",
    route: "bit",
    authorization: "credentials",
    fields: [
      {
        id: "apiKey",
        label: "BIT / Matrixport Access Key",
        control: "text",
        required: true,
      },
      {
        id: "apiSecret",
        label: "BIT / Matrixport Secret Key",
        control: "password",
        required: true,
      },
      {
        id: "userId",
        label: "BIT / Matrixport 用户 ID（个人中心 UID）",
        control: "text",
        required: true,
      },
    ],
    startLabel: "验证只读凭证",
    validationError: "BIT / Matrixport 凭证验证失败",
    dialogLabel: "确认 BIT / Matrixport 资产来源",
    previewTitle: "BIT / Matrixport 凭证预览",
    previewScope: () => "Wallet 余额、Balance+、DCP（只读）",
    savedMaterial: "只读 API 凭证",
    fieldHelp: "对应 Matrixport 创建成功页的 Access Key、Secret Key 和个人中心 UID。权限勾选“读取、理财”，取消“钱包、交易”；理财权限由 Matrixport 强制绑定公网出口 IP。应用不会调用交易、转账、提现或赎回接口。",
  },
  {
    id: "ethereum",
    label: "Ethereum 观察钱包",
    route: "evm",
    authorization: "public-addresses",
    fields: [
      {
        id: "addresses",
        label: "Ethereum 公开地址（每行一个）",
        control: "textarea",
        required: true,
      },
    ],
    startLabel: "验证公开地址",
    validationError: "Ethereum 公开地址验证失败",
    dialogLabel: "确认 Ethereum 观察钱包",
    previewTitle: "Ethereum 观察钱包公开地址预览",
    previewScope: () => "ETH、ERC-20（公开地址只读）",
    savedMaterial: "公开地址配置",
    fieldHelp: "仅查询公开地址余额。",
  },
  {
    id: "bsc",
    label: "BNB Smart Chain 观察钱包",
    route: "evm",
    authorization: "public-addresses",
    fields: [
      {
        id: "addresses",
        label: "BNB Smart Chain 公开地址（每行一个）",
        control: "textarea",
        required: true,
      },
    ],
    startLabel: "验证公开地址",
    validationError: "BNB Smart Chain 公开地址验证失败",
    dialogLabel: "确认 BNB Smart Chain 观察钱包",
    previewTitle: "BNB Smart Chain 观察钱包公开地址预览",
    previewScope: () => "BNB、BEP-20（公开地址只读）",
    savedMaterial: "公开地址配置",
    fieldHelp: "仅查询公开地址余额。",
  },
];

export function assetSourceProvider(
  id: AssetSourceProviderId,
): AssetSourceProviderDescription {
  return ASSET_SOURCE_PROVIDERS.find((provider) => provider.id === id)!;
}

export function initialAssetSourceFields(): Record<AssetSourceFieldId, string> {
  const values = Object.fromEntries(
    ASSET_SOURCE_PROVIDERS.flatMap((provider) => provider.fields).map((field) => [
      field.id,
      field.defaultValue ?? "",
    ]),
  ) as Record<AssetSourceFieldId, string>;
  return values;
}

export function assetSourceAuthorizationBody(
  provider: AssetSourceProviderDescription,
  values: Record<AssetSourceFieldId, string>,
): Record<string, unknown> {
  const body = Object.fromEntries(
    provider.fields.map((field) => [
      field.id,
      field.id === "addresses"
        ? values.addresses
            .split(/\r?\n/)
            .map((value) => value.trim())
            .filter(Boolean)
        : values[field.id],
    ]),
  );
  return provider.authorization === "public-addresses"
    ? { chain: provider.id, ...body }
    : body;
}
