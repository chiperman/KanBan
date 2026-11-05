import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { packPlugin } from './lib/plugin-archive.mjs';
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [release, output = 'dist/plugins/release'] = process.argv.slice(2);
if (!/^plugins-v\d+\.\d+\.\d+$/.test(release ?? '')) throw new Error('用法：pnpm plugins:release plugins-v1.0.0 [输出目录]');
const repository = process.env.KANBAN_PLUGIN_REPOSITORY || 'chiperman/KanBan';
if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('GitHub 仓库无效');
const destination = path.resolve(output);
if (existsSync(destination)) throw new Error('发行目录已存在，请删除旧产物或指定新目录');
const temporary = mkdtempSync(path.join(tmpdir(), 'kanban-plugin-release-'));
try {
  const packages = path.join(temporary, 'packages');
  execFileSync(process.execPath, [path.join(workspace, 'scripts/build-source-plugins.mjs'), packages], { cwd: workspace, stdio: 'inherit' });
  mkdirSync(destination, { recursive: true });
  const plugins = [], sums = [];
  for (const folder of readdirSync(packages).sort()) {
    const directory = path.join(packages, folder);
    const manifest = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
    const asset = `${folder}-${manifest.version}.tar.gz`, archive = packPlugin(directory);
    const sha256 = createHash('sha256').update(archive).digest('hex');
    writeFileSync(path.join(destination, asset), archive);
    plugins.push({ id: manifest.id, label: manifest.description?.label || 'CoinGecko', version: manifest.version, asset, size: archive.length, sha256, manifest });
    sums.push(`${sha256}  ${asset}`);
  }
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim();
  const catalog = { format: 1, protocolVersion: 1, nodeMajor: Number(process.versions.node.split('.')[0]), repository, release, sourceCommit, plugins };
  const content = JSON.stringify(catalog, null, 2) + '\n';
  writeFileSync(path.join(destination, 'catalog.json'), content);
  sums.push(`${createHash('sha256').update(content).digest('hex')}  catalog.json`);
  writeFileSync(path.join(destination, 'SHA256SUMS'), sums.join('\n') + '\n');
  console.log(`发行产物：${destination}（${plugins.length} 个插件）`);
} catch (error) { rmSync(destination, { recursive: true, force: true }); throw error; }
finally { rmSync(temporary, { recursive: true, force: true }); }
