import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { unpackPlugin, MAX_PLUGIN_ARCHIVE } from '../../../scripts/lib/plugin-archive.mjs';
import { readInstalledManifest } from './registry';
import { PluginManagementError } from './installation';
export { MAX_PLUGIN_ARCHIVE };
export function inspectPluginArchive(archive: Buffer) {
  const directory = mkdtempSync(path.join(tmpdir(), 'kanban-plugin-inspect-'));
  try {
    unpackPlugin(archive, directory);
    const manifest = readInstalledManifest(directory);
    return { id: manifest.id, version: manifest.version, label: manifest.description?.label ?? manifest.id,
      publisher: manifest.metadata?.publisher ?? '未声明', summary: manifest.metadata?.summary ?? manifest.description?.previewScope ?? '',
      sha256: createHash('sha256').update(archive).digest('hex') };
  } catch { throw new PluginManagementError('插件包格式、入口或协议无效'); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}
