import registry from '../../plugins/official.json' with { type: 'json' };
import type { PluginManagementStatus } from './plugin-management';

export function createDemoOfficialIntegrationsData(): {
  status: PluginManagementStatus;
} {
  const plugins = registry.plugins.map(plugin => ({
    ...plugin,
    version: plugin.id === 'evm-watch-bsc' ? null : plugin.id === 'binance' ? '1.1.0' : '1.0.0',
  }));
  return {
    status: {
      repository: 'chiperman/KanBan',
      installed: plugins.map(plugin => ({
          ...plugin,
          version: '1.0.0',
          enabled: true,
          healthy: true,
          retainedVersions: [],
        })),
    },
  };
}
