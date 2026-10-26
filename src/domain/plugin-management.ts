export interface InstalledPluginStatus {
  id: string; label: string; summary: string; publisher: string; homepage?: string; repository?: string; source?: 'github'; version: string; assetSource: boolean; enabled: boolean; healthy: boolean; retainedVersions: string[];
}
export interface AvailablePluginStatus { id: string; label: string; version: string | null; summary: string; publisher: string; homepage?: string; repository?: string; sha256?: string; assetSource: boolean }
export interface PluginManagementStatus { repository: string; installed: InstalledPluginStatus[] }
export interface PluginCatalogStatus { release: string | null; notice?: string; plugins: AvailablePluginStatus[] }
export interface GitHubPluginCatalog { repository: string; release: string; plugins: (AvailablePluginStatus & { version: string; sha256: string })[] }
export type PluginManagementAction = 'install' | 'update' | 'enable' | 'disable' | 'uninstall' | 'rollback';
