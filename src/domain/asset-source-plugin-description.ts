import { assetSourceProvider } from "./asset-source-providers";
import type { AssetSourceFieldDescription, AssetSourceProviderDescription, AssetSourceProviderId } from "./asset-source-providers";

/** 只包含可序列化的字段描述，不允许插件向浏览器注入代码或 HTML。 */
export interface AssetSourcePluginDescription {
  label: string;
  fields: AssetSourceFieldDescription[];
  previewScope: string;
  fieldHelp?: string;
}

export function pluginProviderDescription(id: AssetSourceProviderId, description: AssetSourcePluginDescription): AssetSourceProviderDescription {
  const legacy = assetSourceProvider(id);
  if (legacy) return { ...legacy, fields: description.fields, label: description.label,
    ...(description.fieldHelp ? { fieldHelp: description.fieldHelp } : {}),
  };
  return {
    ...description, id, route: `plugins/${encodeURIComponent(id)}`,
    authorization: "credentials", startLabel: "验证只读凭证",
    validationError: "插件凭证验证失败", dialogLabel: `确认 ${description.label} 资产来源`,
    previewTitle: `${description.label} 授权预览`, previewScope: () => description.previewScope,
    savedMaterial: "只读凭证",
  };
}
