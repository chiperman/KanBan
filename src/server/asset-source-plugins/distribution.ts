import path from 'node:path';
import { readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { AvailablePluginStatus, GitHubPluginCatalog, PluginCatalogStatus, PluginManagementAction, PluginManagementStatus } from '@/domain/plugin-management';
import { MAX_PLUGIN_ARCHIVE } from '../../../scripts/lib/plugin-archive.mjs';
import { assertPluginManifest, type InstalledPluginManifest } from './manifest';
import { pluginDirectoryName, readInstalledManifest, readPluginRegistry } from './registry';
import { PluginInstaller, PluginManagementError, comparePluginVersions } from './installation';
import { bundledMarketRegistry, parseMarketRegistry, type MarketRegistry } from './market-registry';
import { parseGitHubPluginSource } from './github-source';
interface CatalogEntry { id: string; label: string; version: string; asset: string; size: number; sha256: string; manifest: InstalledPluginManifest }
interface Catalog { release: string; format: number; protocolVersion: number; nodeMajor: number; repository: string; plugins: CatalogEntry[] }
export class PluginDistribution {
  readonly repository: string;
  private cached?: { catalog: Catalog; at: number };
  private githubCatalogs = new Map<string, { catalog: Catalog; at: number }>();
  private market?: { registry: MarketRegistry; at: number };
  readonly installer: PluginInstaller;
  constructor(readonly root: string, private readonly request: typeof fetch = fetch, repository = process.env.KANBAN_PLUGIN_REPOSITORY || 'chiperman/KanBan') {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new PluginManagementError('插件仓库配置无效');
    this.repository = repository; this.installer = new PluginInstaller(root);
  }
  status(): PluginManagementStatus {
    const registry = readPluginRegistry(this.root);
    return { repository: this.repository, installed: Object.entries(registry).map(([id, entry]) => {
      let label = id, summary = '', publisher = '未声明', homepage: string | undefined, healthy = false, assetSource = false;
      try { const m = readInstalledManifest(path.join(this.root, pluginDirectoryName(id), entry.version)); label = m.description?.label ?? (id === 'plugin:coingecko' ? 'CoinGecko' : id); summary = m.metadata?.summary ?? m.description?.previewScope ?? ''; publisher = m.metadata?.publisher ?? '未声明'; homepage = m.metadata?.homepage; healthy = m.id === id && m.version === entry.version; assetSource = m.capabilities.includes('assets.read'); } catch { /* Keep damaged installations visible for management. */ }
      let retainedVersions: string[] = [];
      try { retainedVersions = readdirSync(path.join(this.root, pluginDirectoryName(id))).filter(v => /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(v) && comparePluginVersions(v, entry.version) < 0).sort((a, b) => comparePluginVersions(b, a)); } catch { /* No retained packages. */ }
      return { id, label, summary, publisher, homepage, repository: entry.repository, source: entry.source, version: entry.version, assetSource, enabled: entry.enabled, healthy, retainedVersions };
    }) };
  }
  async available(refresh = false, release?: string): Promise<PluginCatalogStatus> {
    const [market, published] = await Promise.allSettled([this.marketplace(refresh), this.catalog(refresh, release)]);
    const registry = market.status === 'fulfilled' ? market.value.registry : bundledMarketRegistry;
    const entries = new Map<string, AvailablePluginStatus>(registry.plugins.map(entry => [entry.id, { ...entry, version: null, repository: entry.repository ?? this.repository }]));
    // An installed plugin follows its original repository even when the directory changes or delists it.
    for (const p of this.status().installed) if (p.repository) entries.set(p.id, { ...p, version: null });
    const catalog = published.status === 'fulfilled' ? published.value : this.cached?.catalog;
    for (const p of catalog?.plugins ?? []) {
      if (entries.get(p.id)?.repository?.toLowerCase() !== this.repository.toLowerCase() && entries.has(p.id)) continue;
      entries.set(p.id, this.availableEntry(p, this.repository));
    }
    const repositories = [...new Set([...entries.values()].map(p => p.repository!.toLowerCase()).filter(r => r !== this.repository.toLowerCase()))];
    const catalogs = await Promise.allSettled(repositories.map(r => this.githubCatalog(r, refresh)));
    let unavailable = false, incomplete = false;
    for (const [id, p] of entries) {
      const index = repositories.indexOf(p.repository!.toLowerCase());
      if (index < 0) continue;
      const result = catalogs[index];
      const entry = result.status === 'fulfilled' ? result.value.plugins.find(e => e.id === id) : undefined;
      if (entry) entries.set(id, this.availableEntry(entry, p.repository!));
      else if (result.status === 'fulfilled') incomplete = true;
      else unavailable = true;
    }
    const notice = [market.status === 'fulfilled' ? market.value.notice : '暂时无法刷新插件目录', published.status === 'rejected' ? published.reason instanceof PluginManagementError ? published.reason.message : '暂时无法刷新官方插件版本' : undefined,
      unavailable ? '部分插件暂时无法检查更新，请稍后重试' : undefined,
      incomplete ? '部分插件未包含在最新发行目录中，请联系插件开发者补齐全量目录' : undefined].filter(Boolean).join('；');
    return { release: catalog?.release ?? null, plugins: [...entries.values()], ...(notice ? { notice } : {}) };
  }
  async change(action: PluginManagementAction, id: string, version?: string, release?: string, expected?: { repository?: string; sha256?: string }) {
    if (action === 'install' || action === 'update') {
      if (id === 'coingecko') id = 'plugin:coingecko';
      const prior = readPluginRegistry(this.root)[id];
      if (action === 'install' && prior) throw new PluginManagementError('插件已安装，请使用更新');
      const repository = action === 'update' && prior?.repository ? prior.repository
        : (await this.marketplace(true)).registry.plugins.find(p => p.id === id)?.repository ?? this.repository;
      const catalog = await this.githubCatalog(repository, true, repository.toLowerCase() === this.repository.toLowerCase() ? release : undefined);
      const entry = catalog.plugins.find(p => p.id === id);
      if (!entry) throw new PluginManagementError('此仓库的发行目录没有包含该插件，请联系开发者');
      await this.installEntry(entry, repository, catalog.release, expected, version, action === 'update', 'github');
    } else await this.installer.change(action, id, version);
    return this.status();
  }
  async inspectGitHub(source: string): Promise<GitHubPluginCatalog> {
    const { repository, release } = parseGitHubPluginSource(source);
    const catalog = await this.githubCatalog(repository, true, release);
    return { repository, release: catalog.release, plugins: catalog.plugins.map(p => this.availableEntry(p, repository)) };
  }
  async installGitHub(source: string, id: string, expected: { version: string; repository: string; sha256: string }) {
    const { repository, release } = parseGitHubPluginSource(source);
    if (!release) throw new PluginManagementError('请先预览插件并确认具体发行版本');
    const catalog = await this.githubCatalog(repository, true, release);
    const entry = catalog.plugins.find(p => p.id === id);
    if (!entry) throw new PluginManagementError('此 Release 没有包含选中的插件，请重新查看');
    await this.installEntry(entry, repository, release, expected, expected.version, false, 'github');
    return this.status();
  }
  private availableEntry(entry: CatalogEntry, repository: string) {
    return { id: entry.id, label: entry.label, version: entry.version, repository, sha256: entry.sha256,
      assetSource: entry.manifest.capabilities.includes('assets.read'), summary: entry.manifest.metadata?.summary ?? entry.manifest.description?.previewScope ?? '',
      publisher: entry.manifest.metadata?.publisher ?? '未声明', homepage: entry.manifest.metadata?.homepage };
  }
  private async installEntry(entry: Omit<CatalogEntry, 'label' | 'manifest'> & { manifest?: InstalledPluginManifest }, repository: string, release: string,
    expected: { repository?: string; sha256?: string } | undefined, version: string | undefined, updating: boolean, source?: 'github') {
    if (version !== undefined && entry.version !== version) throw new PluginManagementError('插件版本已变化，请检查更新后重新确认');
    if ((expected?.repository !== undefined && expected.repository !== repository) || (expected?.sha256 !== undefined && expected.sha256 !== entry.sha256)) throw new PluginManagementError('插件发布来源或内容已变化，请重新查看并确认');
    const archive = await this.download(this.assetUrl(release, entry.asset, repository), MAX_PLUGIN_ARCHIVE);
    if (archive.length !== entry.size || createHash('sha256').update(archive).digest('hex') !== entry.sha256) throw new PluginManagementError('下载包校验失败，请重新下载');
    await this.installer.install({ archive, id: entry.id, version: entry.version, release, repository, source, manifest: entry.manifest }, updating);
  }
  private async githubCatalog(repository: string, refresh: boolean, requested?: string): Promise<Catalog> {
    // Official compatibility IDs can only come from the configured official repository.
    if (repository.toLowerCase() === this.repository.toLowerCase()) return this.catalog(refresh, requested);
    if (requested && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(requested)) throw new PluginManagementError('插件 Release tag 格式无效');
    const key = `${repository.toLowerCase()}#${requested ?? ''}`, cached = this.githubCatalogs.get(key);
    if (!refresh && cached && Date.now() - cached.at < 300_000) return cached.catalog;
    let release = requested;
    if (!release) {
      const releases: unknown = JSON.parse((await this.download(`https://api.github.com/repos/${repository}/releases?per_page=100`, 2 * 1024 * 1024, 8000)).toString('utf8'));
      if (!Array.isArray(releases)) throw new PluginManagementError('GitHub 发行列表无效');
      release = releases.find(r => r && r.draft === false && r.prerelease === false && typeof r.tag_name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(r.tag_name) && Array.isArray(r.assets) && r.assets.some((a: { name?: unknown }) => a?.name === 'catalog.json'))?.tag_name;
      if (!release) throw new PluginManagementError('此仓库尚未发布 KanBan 插件，请让开发者上传插件包及 catalog.json，或导入本地插件包');
    }
    const catalog = this.parseCatalog(JSON.parse((await this.download(this.assetUrl(release, 'catalog.json', repository), 512 * 1024, 8000)).toString('utf8')), repository, release, false);
    this.githubCatalogs.set(key, { catalog, at: Date.now() });
    return catalog;
  }
  private assetUrl(release: string, asset: string, repository = this.repository) {
    return `https://github.com/${repository}/releases/download/${encodeURIComponent(release)}/${encodeURIComponent(asset)}`;
  }
  private async marketplace(refresh: boolean): Promise<{ registry: MarketRegistry; notice?: string }> {
    if (!refresh && this.market && Date.now() - this.market.at < 300_000) return { registry: this.market.registry };
    try {
      const raw = await this.download(`https://raw.githubusercontent.com/${this.repository}/main/plugins/registry.json`, 512 * 1024, 8000);
      const registry = parseMarketRegistry(JSON.parse(raw.toString('utf8')));
      this.market = { registry, at: Date.now() }; return { registry };
    } catch {
      return { registry: this.market?.registry ?? bundledMarketRegistry, notice: '暂时无法刷新插件目录，显示已有目录介绍' };
    }
  }
  private async download(url: string, limit: number, timeout = 30_000): Promise<Buffer> {
    try {
      const response = await this.request(url, { signal: AbortSignal.timeout(timeout), headers: { Accept: url.startsWith('https://api.github.com/') ? 'application/vnd.github+json' : 'application/octet-stream' }, cache: 'no-store' });
      if (!response.ok || !response.body) throw new PluginManagementError(response.status === 404 ? '尚未发布此插件版本' : `插件服务器暂不可用（${response.status}）`);
      if (Number(response.headers.get('content-length')) > limit) throw new PluginManagementError('下载内容超出大小限制');
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length;
          if (size > limit) throw new PluginManagementError('下载内容超出大小限制'); chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => undefined); }
      return Buffer.concat(chunks);
    } catch (e) {
      if (e instanceof PluginManagementError) throw e;
      throw new PluginManagementError('无法连接插件服务器，请检查网络后重试');
    }
  }
  private async catalog(refresh: boolean, requested?: string): Promise<Catalog> {
    if (requested && !/^plugins-v\d+\.\d+\.\d+$/.test(requested)) throw new PluginManagementError('发行版本格式应为 plugins-v1.0.0');
    if (!refresh && this.cached && Date.now() - this.cached.at < 300_000 && (!requested || requested === this.cached.catalog.release)) return this.cached.catalog;
    let release = requested;
    if (!release) {
      const releases: unknown = JSON.parse((await this.download(`https://api.github.com/repos/${this.repository}/releases?per_page=100`, 2 * 1024 * 1024, 8000)).toString('utf8'));
      if (!Array.isArray(releases)) throw new PluginManagementError('GitHub 发行列表无效');
      const stable = releases.filter(r => r && r.draft === false && r.prerelease === false && /^plugins-v\d+\.\d+\.\d+$/.test(r.tag_name));
      stable.sort((a, b) => comparePluginVersions(b.tag_name.slice(9), a.tag_name.slice(9)));
      release = stable[0]?.tag_name as string | undefined;
      if (!release) throw new PluginManagementError('尚未发布插件版本，请等待维护者发布后再安装');
    }
    const raw: unknown = JSON.parse((await this.download(this.assetUrl(release, 'catalog.json'), 512 * 1024, 8000)).toString('utf8'));
    const c = this.parseCatalog(raw, this.repository, release, true);
    this.cached = { catalog: c, at: Date.now() }; return c;
  }
  private parseCatalog(raw: unknown, repository: string, release: string, official: boolean): Catalog {
    const c = raw as Catalog;
    if (!c || c.format !== 1 || c.protocolVersion !== 1 || c.nodeMajor !== Number(process.versions.node.split('.')[0]) || typeof c.repository !== 'string' || c.repository.toLowerCase() !== repository.toLowerCase() || c.release !== release || !Array.isArray(c.plugins) || !c.plugins.length || c.plugins.length > 100) throw new PluginManagementError('插件目录与当前系统不兼容');
    const ids = new Set(), assets = new Set();
    for (const e of c.plugins) {
      try { assertPluginManifest(e?.manifest); } catch { throw new PluginManagementError('插件发行目录的清单无效，请联系开发者'); }
      if (e.id !== e.manifest.id || e.version !== e.manifest.version || typeof e.label !== 'string' || !e.label.trim() || e.label.length > 80 || typeof e.asset !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.tar\.gz$/.test(e.asset) || typeof e.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(e.sha256) || !Number.isInteger(e.size) || e.size < 1 || e.size > MAX_PLUGIN_ARCHIVE || ids.has(e.id) || assets.has(e.asset)) throw new PluginManagementError('插件目录无效');
      if (!official && (!e.id.startsWith('plugin:') || e.id === 'plugin:coingecko')) throw new PluginManagementError('第三方插件须使用自己的 plugin: ID，不能替换官方插件');
      ids.add(e.id); assets.add(e.asset);
    }
    return c;
  }
}
