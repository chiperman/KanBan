export interface InstalledPluginStatus {
  id: string; label: string; summary: string; publisher: string; homepage?: string; repository?: string; source?: 'github'; version: string; assetSource: boolean; enabled: boolean; healthy: boolean; retainedVersions: string[];
}
export interface PluginManagementStatus { repository: string; installed: InstalledPluginStatus[] }
