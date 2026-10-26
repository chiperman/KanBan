import { isPersistedAssetSourceKind } from "@/domain/asset-source-kinds";
import type { AssetSourcePluginManifest } from "./protocol";

export interface InstalledPluginManifest extends AssetSourcePluginManifest {
  entry: string;
}
const text = (value: unknown, limit = 300): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= limit;

export function assertPluginManifest(value: unknown): asserts value is InstalledPluginManifest {
  const m = value as InstalledPluginManifest | null;
  if (!m || !isPersistedAssetSourceKind(m.id) || (m.id as string) === "manual" ||
      !text(m.version) || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(m.version) || m.protocolVersion !== 1 ||
      !text(m.entry) || !/^[a-zA-Z0-9_./-]+\.mjs$/.test(m.entry) || m.entry.startsWith("/") || m.entry.split("/").some(part => part === ".." || part === "")) throw new Error("插件清单或协议无效");
  if (!Array.isArray(m.capabilities) || new Set(m.capabilities).size !== m.capabilities.length ||
      !(m.capabilities.includes("extension.call") || ["assets.read", "authorization.preview", "authorization.revalidate"].every(c => m.capabilities.includes(c as never))) ||
      m.capabilities.some(c => !["assets.read", "authorization.preview", "authorization.revalidate", "extension.call"].includes(c))) throw new Error("插件能力不兼容");
  if (m.metadata && (!text(m.metadata.summary, 500) || !text(m.metadata.publisher, 100) ||
      (m.metadata.license !== undefined && !text(m.metadata.license, 100)) ||
      (m.metadata.homepage !== undefined && (!text(m.metadata.homepage, 500) || !/^https:\/\//.test(m.metadata.homepage))))) throw new Error("插件介绍无效");
  if (m.configuration && (!Array.isArray(m.configuration) || m.configuration.some(k => !["coingecko.apiKey", "rpc.ethereum", "rpc.bsc"].includes(k)))) throw new Error("插件配置权限无效");
  if (!m.capabilities.includes("assets.read")) return;
  const d = m.description;
  if (!d || !text(d.label, 80) || !text(d.previewScope) || (d.fieldHelp !== undefined && !text(d.fieldHelp, 1000)) ||
      !Array.isArray(d.fields) || d.fields.length > 16) throw new Error("插件表单无效");
  const ids = new Set<string>();
  for (const f of d.fields) {
    if (!f || !text(f.id, 64) || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(f.id) || ["__proto__", "constructor", "prototype", "provider"].includes(f.id) ||
        ids.has(f.id) || !text(f.label, 120) || !["text", "password", "textarea", "select"].includes(f.control) || f.required !== true ||
        (f.defaultValue !== undefined && (typeof f.defaultValue !== "string" || f.defaultValue.length > 1000)) ||
        (f.control === "select" && (!Array.isArray(f.options) || !f.options.length || f.options.length > 30 || f.options.some(o => !o || !text(o.value, 120) || !text(o.label, 120)) || new Set(f.options.map(o => o.value)).size !== f.options.length || (f.defaultValue !== undefined && !f.options.some(o => o.value === f.defaultValue))))) throw new Error("插件表单字段无效");
    ids.add(f.id);
  }
}

export function pluginAuthorizationInput(manifest: AssetSourcePluginManifest, body: unknown): Record<string, string> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("只读授权材料格式无效");
  if (manifest.id === "longbridge") {
    const p = body as Record<string, unknown>;
    return Object.fromEntries(["code", "codeVerifier", "redirectUri", "connectionMode", "sourceId"].flatMap(k => typeof p[k] === "string" ? [[k, p[k] as string]] : []));
  }
  return Object.fromEntries((manifest.description?.fields ?? []).map(field => {
    const raw = (body as Record<string, unknown>)[field.id];
    const value = manifest.id.startsWith("evm-watch-") && field.id === "addresses" && Array.isArray(raw) && raw.every(v => typeof v === "string") ? raw.join("\n") : raw;
    if (typeof value !== "string" || !value.trim() || value.length > 16000 ||
        (field.control === "select" && !field.options?.some(option => option.value === value))) throw new Error("只读授权材料格式无效");
    return [field.id, value];
  }));
}
