import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseMarketRegistry } from '@/server/asset-source-plugins/market-registry';
import { assertPluginManifest } from '@/server/asset-source-plugins/manifest';
import { PluginInstaller } from '@/server/asset-source-plugins/installation';
import { readReleaseBundle, pluginReleasePattern } from './lib/plugin-release.mjs';

const args = process.argv.slice(2);
function option(name: string) {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const value = args[at + 1];
  if (!value || value.startsWith('--')) throw new Error(`缺少 ${name} 参数`);
  args.splice(at, 2);
  return value;
}
const release = option('--release') || 'plugins-v0.0.0';
const output = option('--output');
if (args.length || !pluginReleasePattern.test(release)) throw new Error('用法：pnpm plugins:verify [--release plugins-v1.0.0 --output 新目录]');
const repository = process.env.KANBAN_PLUGIN_REPOSITORY || 'chiperman/KanBan';
const temporary = mkdtempSync(path.join(tmpdir(), 'kanban-plugin-verify-'));
try {
  const registry = parseMarketRegistry(JSON.parse(readFileSync('plugins/registry.json', 'utf8')));
  const destination = output ? path.resolve(output) : path.join(temporary, 'release');
  execFileSync(process.execPath, ['scripts/release-source-plugins.mjs', release, destination], { stdio: 'inherit' });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const { catalog, files } = readReleaseBundle(destination, repository, release, commit);
  const installer = new PluginInstaller(path.join(temporary, 'source-plugins'));
  const official = registry.plugins.filter(p => !p.repository);
  const ids = new Set(catalog.plugins.map((entry: { id: string }) => entry.id));
  if (official.length !== ids.size || official.some(p => !ids.has(p.id))) throw new Error('官方插件包与浏览目录不一致');
  for (const entry of catalog.plugins) {
    assertPluginManifest(entry.manifest);
    const listed = official.find(p => p.id === entry.id);
    if (!listed || listed.assetSource !== entry.manifest.capabilities.includes('assets.read')) throw new Error(`插件目录能力与清单不一致：${entry.id}`);
    const id = await installer.install({ archive: files.get(entry.asset)!, id: entry.id, version: entry.version, manifest: entry.manifest });
    if (id !== entry.id) throw new Error('试装结果与发行目录不一致');
    console.log(`插件包及握手通过：${entry.id} ${entry.version}`);
  }
  console.log(`插件验证通过：${catalog.plugins.length} 个官方包；${registry.plugins.length - official.length} 个第三方目录条目仅作静态校验。`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
