import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { unpackPlugin } from '../../../scripts/lib/plugin-archive.mjs';
import { readInstalledManifest, readPluginRegistry, pluginDirectoryName, type PluginRegistry } from './registry';
import { invokePlugin } from './stdio-host';
import { isDeepStrictEqual } from 'node:util';
import type { InstalledPluginManifest } from './manifest';

import { comparePluginVersions } from '@/domain/plugin-version';
export { comparePluginVersions } from '@/domain/plugin-version';

export class PluginManagementError extends Error {}
export function pluginFingerprint(directory: string): string {
  const digest = createHash('sha256'); let size = 0, count = 0;
  function visit(relative: string) {
    for (const name of readdirSync(path.join(directory, relative)).sort()) {
      const child = path.join(relative, name), file = path.join(directory, child), stat = lstatSync(file);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new PluginManagementError('插件包不能包含符号链接或特殊文件');
      if (stat.isDirectory()) visit(child);
      else {
        if (++count > 4000 || (size += stat.size) > 64 * 1024 * 1024) throw new PluginManagementError('插件包大小超限');
        digest.update(child.split(path.sep).join('/')).update('\0').update(readFileSync(file)).update('\0');
      }
    }
  }
  visit(''); return digest.digest('hex');
}
export class PluginInstaller {
  readonly root: string;
  constructor(root: string) { this.root = path.resolve(root); }
  private async transaction<T>(action: (registry: PluginRegistry, staging: string) => Promise<T>): Promise<T> {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const lock = path.join(this.root, '.install-lock');
    try { mkdirSync(lock, { mode: 0o700 }); }
    catch { throw new PluginManagementError('其他插件操作正在进行，请稍后重试；异常退出遗留的锁可在停止服务后移除 source-plugins/.install-lock'); }
    const staging = path.join(this.root, `.staging-${randomUUID()}`), temporary = path.join(this.root, `registry-${randomUUID()}.tmp`);
    try {
      writeFileSync(path.join(lock, 'pid'), String(process.pid), { mode: 0o600 });
      const registry = readPluginRegistry(this.root), result = await action(registry, staging);
      writeFileSync(temporary, JSON.stringify(registry, null, 2) + '\n', { mode: 0o600 });
      renameSync(temporary, path.join(this.root, 'registry.json')); return result;
    } finally {
      rmSync(staging, { recursive: true, force: true }); rmSync(temporary, { force: true }); rmSync(lock, { recursive: true, force: true });
    }
  }
  async install(input: { directory: string } | { archive: Buffer; id?: string; version?: string; release?: string; repository?: string; source?: 'github'; manifest?: InstalledPluginManifest }, updating = false) {
    return this.transaction(async (registry, staging) => {
      if ('directory' in input) {
        const source = path.resolve(input.directory);
        if (this.root === source || this.root.startsWith(source + path.sep)) throw new PluginManagementError('插件包不能包含安装目录');
        const before = pluginFingerprint(source);
        cpSync(source, staging, { recursive: true, force: false, errorOnExist: true });
        if (pluginFingerprint(staging) !== before) throw new PluginManagementError('插件包复制校验失败');
      } else unpackPlugin(input.archive, staging);
      const manifest = readInstalledManifest(staging), prior = registry[manifest.id];
      if ('archive' in input && input.id !== undefined && (manifest.id !== input.id || manifest.version !== input.version)) throw new PluginManagementError('下载包与发行目录不匹配');
      if ('archive' in input && input.manifest && !isDeepStrictEqual(manifest, input.manifest)) throw new PluginManagementError('插件清单与安装预览不同，请联系开发者重新打包');
      if ('archive' in input && prior?.repository && input.repository && prior.repository.toLowerCase() !== input.repository.toLowerCase()) throw new PluginManagementError('插件发布仓库已变化，请核对来源后卸载并重新安装');
      if (updating && !prior) throw new PluginManagementError('插件未安装');
      if (prior && comparePluginVersions(manifest.version, prior.version) < 0) throw new PluginManagementError('安装不能降级，请使用回滚命令');
      await this.probe(staging);
      const target = path.join(this.root, pluginDirectoryName(manifest.id), manifest.version);
      mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      if (existsSync(target)) {
        if (pluginFingerprint(target) !== pluginFingerprint(staging)) throw new PluginManagementError('同版本插件内容不同，请提升版本号');
      } else renameSync(staging, target);
      registry[manifest.id] = { version: manifest.version, enabled: prior?.enabled ?? true, revision: randomUUID(),
        ...('archive' in input ? { release: input.release, repository: input.repository, source: input.source } : {}) };
      return manifest.id;
    });
  }
  async change(action: 'enable' | 'disable' | 'uninstall' | 'rollback', id: string, version?: string) {
    return this.transaction(async registry => {
      if (!Object.hasOwn(registry, id)) throw new PluginManagementError('插件未安装');
      if (action === 'uninstall') delete registry[id];
      else if (action === 'rollback') {
        if (!version || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version) || comparePluginVersions(version, registry[id].version) >= 0) throw new PluginManagementError('请选择已保留的更早版本');
        const directory = path.join(this.root, pluginDirectoryName(id), version), manifest = readInstalledManifest(directory);
        if (manifest.id !== id || manifest.version !== version) throw new PluginManagementError('回滚包不匹配');
        await this.probe(directory);
        registry[id] = { version, enabled: registry[id].enabled, repository: registry[id].repository, source: registry[id].source, revision: randomUUID() };
      } else {
        if (action === 'enable') await this.probe(path.join(this.root, pluginDirectoryName(id), registry[id].version));
        registry[id].enabled = action === 'enable'; registry[id].revision = randomUUID();
      }
    });
  }
  private async probe(directory: string) {
    const manifest = readInstalledManifest(directory);
    try {
      await invokePlugin({ directory, manifest, available: () => true }, 'initialize', {}, {
        signal: AbortSignal.timeout(5000), persistCredentials: async () => { throw new Error(); },
      }, undefined, 5000);
    } catch { throw new PluginManagementError('插件启动检查失败，当前安装保持不变'); }
  }
}
