import registry from '../../plugins/registry.json' with { type: 'json' };
import type { PluginCatalogStatus, PluginManagementStatus } from './plugin-management';

export function createDemoPluginMarketplaceData(): {
  status: PluginManagementStatus;
  catalog: PluginCatalogStatus;
} {
  const plugins = registry.plugins.map(plugin => ({
    ...plugin,
    version: plugin.id === 'evm-watch-bsc' ? null : plugin.id === 'binance' ? '1.1.0' : '1.0.0',
  }));
  return {
    status: {
      repository: 'chiperman/KanBan',
      installed: plugins
        .filter(plugin => ['binance', 'okx', 'plugin:coingecko'].includes(plugin.id))
        .map(plugin => ({
          ...plugin,
          version: '1.0.0',
          enabled: plugin.id !== 'okx',
          healthy: true,
          retainedVersions: plugin.id === 'binance' ? ['0.9.0'] : [],
        })),
    },
    catalog: {
      release: null,
      notice: '演示模式：版本与安装状态为虚构数据，仅供预览。安装及管理操作不可用。',
      plugins,
    },
  };
}
