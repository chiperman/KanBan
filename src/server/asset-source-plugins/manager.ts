import { isPersistedAssetSourceKind } from "@/domain/asset-source-kinds";
import type { AssetSourceRefresher, AssetSourceSummary } from "@/server/ports";
import { AssetSourcePluginUnavailableError } from "@/server/asset-sync-diagnostics";
import {
  ASSET_SOURCE_PLUGIN_PROTOCOL_VERSION,
  type AssetSourcePlugin,
  type AssetSourcePluginManifest,
  type AssetSourcePluginAuthorization,
} from "./protocol";
import { sourceAuthorizationProvider } from "./provider-id";
import { pluginAuthorizationInput } from "./manifest";
import type { AssetSourceProviderAdapter } from "@/server/asset-source-onboarding";
import type { AssetSourcePluginId } from "./protocol";
import { assertPluginSnapshot } from "./snapshot-validation";

/** 注册及执行与持久化身份分离；未安装插件不妨碍读取旧来源数据。 */
export class AssetSourcePluginManager implements AssetSourceRefresher {
  private readonly registered = new Map<string, AssetSourcePlugin>();
  private readonly supplier?: () => readonly AssetSourcePlugin[];
  private get plugins(): Map<string, AssetSourcePlugin> {
    return this.supplier ? new AssetSourcePluginManager(this.supplier()).registered : this.registered;
  }

  constructor(plugins: readonly AssetSourcePlugin[] | (() => readonly AssetSourcePlugin[])) {
    if (typeof plugins === "function") { this.supplier = plugins; return; }
    for (const plugin of plugins) {
      const manifest = plugin.manifest;
      if (!manifest || !isPersistedAssetSourceKind(manifest.id) || (manifest as { id: unknown }).id === "manual") {
        throw new Error("来源插件 ID 无效");
      }
      if (manifest.protocolVersion !== ASSET_SOURCE_PLUGIN_PROTOCOL_VERSION) throw new Error("来源插件协议版本不兼容");
      if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(manifest.version)) throw new Error("来源插件版本无效");
      if (!Array.isArray(manifest.capabilities) || !manifest.capabilities.includes("assets.read") ||
          new Set(manifest.capabilities).size !== manifest.capabilities.length ||
          manifest.capabilities.some(capability => !["assets.read", "authorization.preview", "authorization.revalidate", "extension.call"].includes(capability)) ||
          typeof plugin.read !== "function" ||
          (manifest.capabilities.includes("authorization.preview") && typeof plugin.authorize !== "function") ||
          (manifest.capabilities.includes("authorization.revalidate") && typeof plugin.revalidate !== "function")) {
        throw new Error("来源插件能力声明无效");
      }
      if (this.registered.has(manifest.id)) throw new Error(`来源插件 ID 重复：${manifest.id}`);
      // Copy registration metadata so callers cannot change routing or capabilities after validation.
      this.registered.set(manifest.id, { ...plugin, read: plugin.read.bind(plugin), authorize: plugin.authorize?.bind(plugin), revalidate: plugin.revalidate?.bind(plugin), available: plugin.available?.bind(plugin), manifest: Object.freeze({
        ...structuredClone(manifest), capabilities: Object.freeze([...manifest.capabilities]),
      }) });
    }
  }

  manifests(): AssetSourcePluginManifest[] {
    return [...this.plugins.values()].map(plugin => structuredClone(plugin.manifest));
  }

  available(kind: string): boolean {
    const plugin = this.plugins.get(kind);
    return !!plugin && (plugin.available?.() ?? true);
  }

  assertAvailable(source: AssetSourceSummary): void {
    if (!this.available(source.kind)) throw new AssetSourcePluginUnavailableError();
  }


  descriptions() {
    return this.manifests().filter(m => m.description && this.available(m.id)).map(m => ({ id: sourceAuthorizationProvider(m.id)!, description: structuredClone(m.description!) }));
  }

  providerAdapters(connect: (id: AssetSourcePluginId, authorization: AssetSourcePluginAuthorization, sourceId?: string) => Promise<void>): AssetSourceProviderAdapter[] {
    return [...this.plugins.values()].filter(p => p.manifest.description && p.authorize && p.revalidate).map(p => {
      const id = sourceAuthorizationProvider(p.manifest.id)!;
      const context = () => ({ signal: AbortSignal.timeout(60_000), persistCredentials: async () => { throw new Error("预览不能保存凭证"); } });
      const check = (result: AssetSourcePluginAuthorization) => {
        assertPluginAuthorization(result);
        return {
          provider: id, credentials: result.credentials,
          account: { id: result.account.id, label: result.account.label },
          permissions: [...result.permissions], snapshot: structuredClone(result.snapshot),
          investmentBookId: result.investmentBookId,
          ...(result.accountMode !== undefined ? { accountMode: result.accountMode } : {}),
          ...(result.scopeFingerprint !== undefined ? { scopeFingerprint: result.scopeFingerprint } : {}),
        };
      };
      const available = () => { if (!(p.available?.() ?? true)) throw new AssetSourcePluginUnavailableError(); };
      return {
        provider: id,
        authorize: async (input: unknown, observedAt: string) => {
          available();
          const result = await p.authorize!(pluginAuthorizationInput(p.manifest, input), observedAt, context());
          available(); return check(result);
        },
        revalidate: async (previous, observedAt: string) => {
          available();
          const result = await p.revalidate!(structuredClone(previous) as AssetSourcePluginAuthorization, observedAt, context());
          available(); return check(result);
        },
        connect: async (authorization, sourceId?: string) => {
          available();
          await connect(p.manifest.id, check(authorization as AssetSourcePluginAuthorization), sourceId);
        },
      };
    });
  }

  async refresh(input: Parameters<AssetSourceRefresher["refresh"]>[0]) {
    input.signal.throwIfAborted();
    const plugin = this.plugins.get(input.source.kind);
    if (!plugin || !this.available(input.source.kind)) throw new AssetSourcePluginUnavailableError();
    const { signal, persistCredentials, ...request } = input;
    // Plugins receive an isolated value and cannot mutate a stored source/last successful snapshot.
    const result = await plugin.read(structuredClone(request), { signal, persistCredentials });
    signal.throwIfAborted();
    if (!(plugin.available?.() ?? true)) throw new AssetSourcePluginUnavailableError();
    this.assertAvailable(input.source);
    try { assertPluginSnapshot(result?.snapshot); }
    catch { throw new SyntaxError("来源插件返回的快照无效"); }
    return { snapshot: structuredClone(result.snapshot) };
  }
}

function assertPluginAuthorization(value: unknown): asserts value is AssetSourcePluginAuthorization {
  const a = value as AssetSourcePluginAuthorization | null;
  if (!a || typeof a.credentials !== "string" || !a.credentials || a.credentials.length > 128_000 ||
      !a.account || typeof a.account.id !== "string" || !a.account.id.trim() || a.account.id.length > 512 ||
      typeof a.account.label !== "string" || !a.account.label.trim() || a.account.label.length > 300 ||
      !Array.isArray(a.permissions) || !a.permissions.length || new Set(a.permissions).size !== a.permissions.length ||
      a.permissions.some(p => !["account", "positions", "market-data", "public-address"].includes(p)) ||
      (a.accountMode !== undefined && !["classic", "uta"].includes(a.accountMode)) ||
      ![null, "us-stocks", "a-shares", "crypto"].includes(a.investmentBookId) ||
      (a.scopeFingerprint !== undefined && (typeof a.scopeFingerprint !== "string" || a.scopeFingerprint.length > 4096))) throw new Error("插件只读授权结果无效");
  assertPluginSnapshot(a.snapshot);
}
