import path from 'node:path';
import { existsSync, readFileSync, mkdirSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PluginDistribution } from '@/server/asset-source-plugins/distribution';
import { pluginRoot, readInstalledManifest } from '@/server/asset-source-plugins/registry';
import { parseGitHubPluginSource } from '@/server/asset-source-plugins/github-source';
import { packPlugin } from './lib/plugin-archive.mjs';
try { process.loadEnvFile(path.join(process.cwd(), '.env.local')); }
catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
const args = process.argv.slice(2);
function option(name: string) {
  const i = args.indexOf(name); if (i < 0) return undefined;
  const value = args[i + 1]; if (!value || value.startsWith('--')) throw new Error(`缺少 ${name} 参数`);
  args.splice(i, 2); return value;
}
const dataDir = path.resolve(option('--data-dir') ?? (process.env.KANBAN_DATA_DIR?.trim() || 'data'));
const release = option('--release');
const repository = option('--repository'), pluginId = option('--plugin'), outputDirectory = option('--output');
const [command, argument, version] = args;
const service = new PluginDistribution(pluginRoot(dataDir));
const help = `用法：pnpm plugin available | list | inspect <GitHub仓库/Release地址> | install <ID/GitHub仓库/Release地址/包目录/压缩包> | update <ID> | enable/disable/uninstall <ID> | rollback <ID> <版本>
开发：pnpm plugin create <名称> <新目录> | pack <包目录> <输出.tar.gz> [--repository owner/repo --release v1.0.0]
批量发行：pnpm plugin release <包目录> [包目录...] --output <新目录> --repository owner/repo --release v1.0.0
多插件仓库：install <GitHub仓库> --plugin plugin:<名称>
可选：--data-dir <数据目录>，--release plugins-v1.0.0`;
try {
  if (repository && !['pack', 'release'].includes(command)) throw new Error('--repository 仅用于打包发行，安装时直接填写 GitHub 仓库');
  if (outputDirectory && command !== 'release') throw new Error('--output 仅用于批量发行');
  if (pluginId && command !== 'install') throw new Error('--plugin 仅用于安装时选择插件');
  if (command === 'create' && argument && version && args.length === 3) {
    if (!/^[a-z][a-z0-9-]{1,62}$/.test(argument)) throw new Error('名称使用小写英文字母、数字和短横线');
    const destination = path.resolve(version);
    if (existsSync(destination)) throw new Error('目标目录已存在');
    mkdirSync(destination, { recursive: true });
    cpSync(path.join(import.meta.dirname, '../plugins/sdk/template'), destination, { recursive: true });
    const manifestPath = path.join(destination, 'manifest.json');
    writeFileSync(manifestPath, readFileSync(manifestPath, 'utf8').replaceAll('my-provider', argument));
    console.log(`开发模板已创建：${destination}；先实现 provider.mjs，再用 pnpm plugin pack 打包。`);
  } else if (command === 'pack' && argument && version && args.length === 3) {
    const manifest = readInstalledManifest(path.resolve(argument));
    const archive = packPlugin(path.resolve(argument));
    const sha256 = createHash('sha256').update(archive).digest('hex'), output = path.resolve(version);
    let catalog: string | undefined;
    const catalogPath = path.join(path.dirname(output), 'catalog.json');
    if (repository) {
      if (!release) throw new Error('生成发行目录还需 --release v1.0.0');
      const source = parseGitHubPluginSource(`${repository}/releases/tag/${release}`);
      if (source.repository !== repository || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.tar\.gz$/.test(path.basename(output))) throw new Error('仓库或插件包文件名无效');
      if (repository.toLowerCase() !== service.repository.toLowerCase() && (!manifest.id.startsWith('plugin:') || manifest.id === 'plugin:coingecko')) throw new Error('第三方插件须使用自己的 plugin: ID');
      if (existsSync(catalogPath)) throw new Error('catalog.json 已存在，请使用新的发行输出目录');
      catalog = JSON.stringify({ format: 1, protocolVersion: 1, nodeMajor: Number(process.versions.node.split('.')[0]), repository, release,
        plugins: [{ id: manifest.id, label: manifest.description?.label ?? manifest.id, version: manifest.version, asset: path.basename(output), size: archive.length, sha256, manifest }] }, null, 2) + '\n';
    }
    writeFileSync(output, archive, { flag: 'wx' });
    if (catalog) {
      try { writeFileSync(catalogPath, catalog, { flag: 'wx' }); } catch (error) { rmSync(output); throw error; }
      console.log(`发行目录：${catalogPath}；请与插件包一起上传到 ${repository} 的 ${release} Release。`);
    }
    console.log(`${sha256}  ${output}`);
    console.log(`包大小：${archive.length} 字节`);
  } else if (command === 'release') {
    if (!repository || !release || !outputDirectory || args.length < 2 || args.length > 101) throw new Error(help);
    const source = parseGitHubPluginSource(`${repository}/releases/tag/${release}`);
    if (source.repository !== repository) throw new Error('仓库地址无效，请使用 owner/repo');
    const destination = path.resolve(outputDirectory), ids = new Set<string>(), assets = new Set<string>();
    if (existsSync(destination)) throw new Error('发行目录已存在，请使用新的输出目录');
    const packages = args.slice(1).map(directory => {
      directory = path.resolve(directory);
      if (destination === directory || destination.startsWith(directory + path.sep)) throw new Error('发行输出目录不能位于插件包内');
      const manifest = readInstalledManifest(directory);
      if (repository.toLowerCase() !== service.repository.toLowerCase() && (!manifest.id.startsWith('plugin:') || manifest.id === 'plugin:coingecko')) throw new Error('第三方插件须使用自己的 plugin: ID');
      const asset = `${manifest.id.replace(':', '-')}-${manifest.version}.tar.gz`;
      if (ids.has(manifest.id) || assets.has(asset)) throw new Error('发行目录不能包含重复插件 ID 或附件名');
      ids.add(manifest.id); assets.add(asset);
      return { directory, manifest, asset };
    });
    mkdirSync(path.dirname(destination), { recursive: true });
    mkdirSync(destination);
    try {
      const plugins = packages.map(({ directory, manifest, asset }) => {
        const archive = packPlugin(directory), sha256 = createHash('sha256').update(archive).digest('hex');
        writeFileSync(path.join(destination, asset), archive, { flag: 'wx' });
        return { id: manifest.id, label: manifest.description?.label ?? manifest.id, version: manifest.version, asset, size: archive.length, sha256, manifest };
      });
      const catalog = JSON.stringify({ format: 1, protocolVersion: 1,
        nodeMajor: Number(process.versions.node.split('.')[0]), repository, release, plugins }, null, 2) + '\n';
      if (Buffer.byteLength(catalog) > 512 * 1024) throw new Error('发行目录超过 512 KiB，请缩小插件描述或拆分仓库');
      writeFileSync(path.join(destination, 'catalog.json'), catalog, { flag: 'wx' });
      console.log(`发行产物：${destination}（${plugins.length} 个插件）；请将全部附件和 catalog.json 一起上传到 ${repository} 的 ${release} Release。`);
    } catch (error) { rmSync(destination, { recursive: true, force: true }); throw error; }
  } else if (command === 'list' && args.length === 1) {
    console.log(`数据目录：${dataDir}`);
    const { installed } = service.status();
    if (!installed.length) console.log('尚未安装插件；运行 pnpm plugin available 浏览。');
    for (const p of installed) console.log(`${p.id} ${p.version} ${p.enabled ? '已启用' : '已停用'}${p.healthy ? '' : '（文件损坏）'}`);
  } else if (command === 'available' && args.length === 1) {
    const catalog = await service.available(true, release); console.log(`目录：${service.repository}${catalog.release ? ` · ${catalog.release}` : ''}`);
    if (catalog.notice) console.log(catalog.notice);
    for (const p of catalog.plugins) console.log(`${p.id} ${p.version ?? '待发布'} ${p.label}`);
  } else if (command === 'inspect' && argument && args.length === 2) {
    const catalog = await service.inspectGitHub(argument);
    console.log(`来源：${catalog.repository} · ${catalog.release}`);
    for (const p of catalog.plugins) console.log(`${p.id} ${p.version} ${p.label}\n${p.publisher} · ${p.summary}\nSHA-256：${p.sha256}`);
  } else if (argument && ['install', 'update', 'enable', 'disable', 'uninstall', 'rollback'].includes(command) && args.length === (command === 'rollback' ? 3 : 2)) {
    if (command === 'install' && existsSync(argument)) {
      if (argument.endsWith('.tar.gz')) await service.installer.install({ archive: readFileSync(path.resolve(argument)) });
      else await service.installer.install({ directory: path.resolve(argument) });
    } else if (command === 'install' && (argument.startsWith('github:') || argument.includes('/'))) {
      const catalog = await service.inspectGitHub(argument);
      const entry = pluginId ? catalog.plugins.find(p => p.id === pluginId) : catalog.plugins.length === 1 ? catalog.plugins[0] : undefined;
      if (!entry) throw new Error(`请用 --plugin 指定一个插件：${catalog.plugins.map(p => p.id).join('、')}`);
      await service.installGitHub(`https://github.com/${catalog.repository}/releases/tag/${catalog.release}`, entry.id, { version: entry.version, repository: catalog.repository, sha256: entry.sha256 });
    } else await service.change(command as Parameters<typeof service.change>[0], argument, version, release);
    console.log('插件已更新，下一次请求自动生效；账户、凭证与历史均保留。');
  } else throw new Error(help);
} catch (e) { console.error(e instanceof Error ? e.message : '插件操作失败'); process.exitCode = 1; }
