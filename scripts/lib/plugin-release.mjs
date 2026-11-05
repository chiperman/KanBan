import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { comparePluginVersions } from '../../src/domain/plugin-version.ts';
import { MAX_PLUGIN_ARCHIVE } from './plugin-archive.mjs';
import { assertMainCommit } from './github-main.mjs';

export const pluginReleasePattern = /^plugins-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function parseReleaseCatalog(bytes, repository, release) {
  if (bytes.length > 512 * 1024) throw new Error('插件发行目录超过 512 KiB');
  const catalog = JSON.parse(bytes.toString('utf8'));
  if (!catalog || catalog.format !== 1 || catalog.protocolVersion !== 1 ||
      catalog.nodeMajor !== Number(process.versions.node.split('.')[0]) ||
      catalog.repository !== repository || catalog.release !== release ||
      !Array.isArray(catalog.plugins) || !catalog.plugins.length || catalog.plugins.length > 100) {
    throw new Error('插件发行目录与仓库、版本或运行环境不匹配');
  }
  const ids = new Set(), assets = new Set();
  for (const entry of catalog.plugins) {
    if (!entry || typeof entry.id !== 'string' || !entry.id ||
        typeof entry.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(entry.version) ||
        !entry.manifest || entry.manifest.id !== entry.id || entry.manifest.version !== entry.version ||
        typeof entry.asset !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.tar\.gz$/.test(entry.asset) ||
        !Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > MAX_PLUGIN_ARCHIVE ||
        typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        ids.has(entry.id) || assets.has(entry.asset)) throw new Error('插件发行目录包含无效或重复条目');
    ids.add(entry.id); assets.add(entry.asset);
  }
  return catalog;
}

export function readReleaseBundle(directory, repository, release, commit) {
  const read = name => {
    const file = path.join(directory, name);
    if (!lstatSync(file).isFile()) throw new Error(`发行附件必须为普通文件：${name}`);
    return readFileSync(file);
  };
  const bytes = read('catalog.json'), catalog = parseReleaseCatalog(bytes, repository, release);
  if (!/^[a-f0-9]{40}$/.test(commit) || catalog.sourceCommit !== commit) {
    throw new Error('发行产物与目标提交不匹配');
  }
  const files = new Map([['catalog.json', bytes]]);
  for (const entry of catalog.plugins) {
    const archive = read(entry.asset);
    if (archive.length !== entry.size || digest(archive) !== entry.sha256) throw new Error(`插件附件校验失败：${entry.asset}`);
    files.set(entry.asset, archive);
  }
  const sums = read('SHA256SUMS');
  const expected = [...files].map(([name, content]) => `${digest(content)}  ${name}`).sort();
  const actual = sums.toString('utf8').trim().split('\n').sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('SHA256SUMS 与发行附件不匹配');
  files.set('SHA256SUMS', sums);
  if (JSON.stringify(readdirSync(directory).sort()) !== JSON.stringify([...files.keys()].sort())) {
    throw new Error('发行目录包含未登记文件');
  }
  return { catalog, files };
}

export function verifyReleaseVersions(current, previous) {
  if (comparePluginVersions(current.release.slice(9), previous.release.slice(9)) <= 0) {
    throw new Error(`发行批次须高于 ${previous.release}，请使用新标签`);
  }
  for (const entry of current.plugins) {
    const prior = previous.plugins.find(p => p.id === entry.id);
    if (!prior) continue;
    const order = comparePluginVersions(entry.version, prior.version);
    if (order < 0) throw new Error(`${entry.id} 不能从 ${prior.version} 降级为 ${entry.version}`);
    if (order === 0 && entry.sha256 !== prior.sha256) {
      throw new Error(`${entry.id} 内容已变化，请将插件版本提升到 ${prior.version} 以上（共享 SDK 也会影响包内容）`);
    }
  }
}

async function responseBytes(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) throw new Error('GitHub 响应超出大小限制');
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if ((size += value.length) > limit) throw new Error('GitHub 响应超出大小限制');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  return Buffer.concat(chunks);
}

export class GitHubReleaseClient {
  constructor(token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN) {
    if (!token) throw new Error('此命令需要具有相应仓库权限的 GH_TOKEN 或 GITHUB_TOKEN');
    this.token = token;
  }
  async request(endpoint, { method = 'GET', body, accept = 'application/vnd.github+json', allow404 = false, limit = 8 * 1024 * 1024 } = {}) {
    const url = endpoint.startsWith('https://') ? endpoint : `https://api.github.com/${endpoint}`;
    if (!['api.github.com', 'uploads.github.com'].includes(new URL(url).hostname)) throw new Error('GitHub API 地址无效');
    const response = await fetch(url, {
      method, signal: AbortSignal.timeout(60_000),
      headers: { Authorization: `Bearer ${this.token}`, Accept: accept,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body === undefined ? {} : { 'Content-Type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json' }) },
      ...(body === undefined ? {} : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }),
    });
    if (allow404 && response.status === 404) { await response.body?.cancel(); return null; }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`GitHub ${method} ${new URL(url).pathname} 失败（${response.status}）`); }
    return responseBytes(response, limit);
  }
  async json(endpoint, options) {
    const bytes = await this.request(endpoint, options);
    return bytes === null ? null : bytes.length ? JSON.parse(bytes.toString('utf8')) : null;
  }
  async downloadAsset(repository, asset, limit = MAX_PLUGIN_ARCHIVE) {
    return this.request(`repos/${repository}/releases/assets/${asset.id}`, { accept: 'application/octet-stream', limit });
  }
  async uploadAsset(release, name, content) {
    const url = new URL(release.upload_url.replace(/\{.*$/, ''));
    url.searchParams.set('name', name);
    return this.json(url.href, { method: 'POST', body: content });
  }
}

export async function releaseAssets(client, repository, release) {
  const assets = [];
  for (let page = 1; ; page++) {
    const batch = await client.json(`repos/${repository}/releases/${release.id}/assets?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error('GitHub 附件列表无效');
    assets.push(...batch);
    if (batch.length < 100) return assets;
    if (assets.length > 200) throw new Error('GitHub 发行附件数量超限');
  }
}

export async function assertReleaseCommit(client, repository, release, commit) {
  let ref = await client.json(`repos/${repository}/git/ref/tags/${encodeURIComponent(release)}`);
  for (let depth = 0; ref.object?.type === 'tag' && depth < 5; depth++) {
    ref = await client.json(`repos/${repository}/git/tags/${ref.object.sha}`);
  }
  if (ref.object?.type !== 'commit' || ref.object.sha !== commit) throw new Error('发布标签与目标提交不一致，禁止移动标签后重试');
  await assertMainCommit(client, repository, commit);
}

export async function assertPublishedVersions(client, repository, catalog) {
  let previous;
  for (let page = 1; ; page++) {
    const batch = await client.json(`repos/${repository}/releases?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error('GitHub 发行列表无效');
    for (const release of batch) {
      if (release.draft || release.prerelease || release.tag_name === catalog.release || !pluginReleasePattern.test(release.tag_name)) continue;
      if (!previous || comparePluginVersions(release.tag_name.slice(9), previous.tag_name.slice(9)) > 0) previous = release;
    }
    if (batch.length < 100) break;
  }
  if (!previous) return;
  const assets = await releaseAssets(client, repository, previous);
  const asset = assets.find(a => a.name === 'catalog.json');
  if (!asset) throw new Error(`上一发行 ${previous.tag_name} 缺少 catalog.json`);
  const bytes = await client.downloadAsset(repository, asset, 512 * 1024);
  verifyReleaseVersions(catalog, parseReleaseCatalog(bytes, repository, previous.tag_name));
}

export async function verifyRemoteAssets(client, repository, release, files) {
  const assets = await releaseAssets(client, repository, release);
  if (assets.length !== files.size || new Set(assets.map(a => a.name)).size !== files.size) throw new Error('发行附件数量不完整或包含重复文件');
  for (const asset of assets) {
    const local = files.get(asset.name);
    if (!local || asset.state !== 'uploaded' || asset.size !== local.length || digest(await client.downloadAsset(repository, asset)) !== digest(local)) {
      throw new Error(`已上传附件与本次发行不一致：${asset.name}`);
    }
  }
}
