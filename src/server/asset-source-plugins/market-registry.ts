import bundled from '../../../plugins/registry.json' with { type: 'json' };
import { isPersistedAssetSourceKind } from '@/domain/asset-source-kinds';
import type { AvailablePluginStatus } from '@/domain/plugin-management';
import { PluginManagementError } from './installation';

export type MarketEntry = Omit<AvailablePluginStatus, 'version' | 'sha256'>;
export interface MarketRegistry { format: 1; plugins: MarketEntry[] }
const text = (value: unknown, limit: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= limit;

export function parseMarketRegistry(value: unknown): MarketRegistry {
  const registry = value as MarketRegistry | null;
  if (!registry || registry.format !== 1 || !Array.isArray(registry.plugins) || registry.plugins.length > 100) throw new PluginManagementError('插件目录格式无效');
  const ids = new Set<string>();
  const plugins = registry.plugins.map(entry => {
    if (!entry || !isPersistedAssetSourceKind(entry.id) || entry.id === 'manual' || entry.id.length > 128 || ids.has(entry.id) ||
        !text(entry.label, 80) || !text(entry.summary, 500) || !text(entry.publisher, 100) || typeof entry.assetSource !== 'boolean' ||
        (entry.homepage !== undefined && (!text(entry.homepage, 500) || !/^https:\/\//.test(entry.homepage)))) throw new PluginManagementError('插件目录条目无效');
    ids.add(entry.id);
    // Older directories pinned a package. Keep its repository, but resolve releases from that source.
    const legacy = (entry as MarketEntry & { package?: { repository?: unknown } }).package;
    const repository = entry.repository !== undefined ? entry.repository : legacy?.repository;
    if ((legacy !== undefined && (!legacy || !text(legacy.repository, 200))) ||
        (entry.repository !== undefined && legacy?.repository !== undefined && String(entry.repository).toLowerCase() !== String(legacy.repository).toLowerCase()) ||
        (repository !== undefined && (!entry.id.startsWith('plugin:') || entry.id === 'plugin:coingecko' ||
          !text(repository, 200) || !/^[a-zA-Z0-9][\w.-]*\/[a-zA-Z0-9][\w.-]*$/.test(repository)))) throw new PluginManagementError('插件发布仓库无效');
    return { id: entry.id, label: entry.label, summary: entry.summary, publisher: entry.publisher,
      assetSource: entry.assetSource, ...(entry.homepage ? { homepage: entry.homepage } : {}), ...(repository ? { repository } : {}) };
  });
  return { format: 1, plugins };
}

// This snapshot contains descriptions only; provider code is installed separately.
export const bundledMarketRegistry = parseMarketRegistry(bundled);
