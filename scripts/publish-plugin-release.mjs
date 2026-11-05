import { pathToFileURL } from 'node:url';
import {
  GitHubReleaseClient, pluginReleasePattern, digest, readReleaseBundle,
  assertReleaseCommit, assertPublishedVersions, releaseAssets, verifyRemoteAssets,
} from './lib/plugin-release.mjs';

export async function publishPluginRelease({ client, repository, release, commit, directory }) {
  if (!pluginReleasePattern.test(release || '') || !/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('发行仓库或标签无效');
  const { catalog, files } = readReleaseBundle(directory, repository, release, commit);
  await assertReleaseCommit(client, repository, release, commit);
  let existing = await client.json(`repos/${repository}/releases/tags/${encodeURIComponent(release)}`, { allow404: true });
  if (existing && !existing.draft) {
    await verifyRemoteAssets(client, repository, existing, files);
    console.log(`发行已完成且附件完全一致：${release}；无需重复发布。`);
    return;
  }
  await assertPublishedVersions(client, repository, catalog);
  if (!existing) {
    const body = `KanBan 集成插件\n\n来源提交：${commit}\n\n${catalog.plugins.map(p => `- ${p.label}: ${p.version}`).join('\n')}\n\n在设置 → 插件中检查并确认更新。通用长桥包使用 CLI，不含平台专属 SDK。`;
    existing = await client.json(`repos/${repository}/releases`, {
      method: 'POST', body: { tag_name: release, target_commitish: commit, name: release, body, draft: true, prerelease: false, make_latest: 'false' },
    });
  }
  if (existing.tag_name !== release || existing.target_commitish !== commit || existing.prerelease) throw new Error('已有草稿与目标提交不一致，请先人工核对');
  const assets = await releaseAssets(client, repository, existing);
  if (assets.some(a => !files.has(a.name))) throw new Error('已有草稿含未登记附件，请先人工核对');
  for (const [name, bytes] of files) {
    const matching = assets.filter(a => a.name === name);
    if (matching.length > 1) throw new Error(`草稿存在重复附件：${name}`);
    const remote = matching[0];
    if (remote && remote.state === 'uploaded' && remote.size === bytes.length && digest(await client.downloadAsset(repository, remote)) === digest(bytes)) continue;
    if (remote) await client.json(`repos/${repository}/releases/assets/${remote.id}`, { method: 'DELETE' });
    await client.uploadAsset(existing, name, bytes);
  }
  await verifyRemoteAssets(client, repository, existing, files);
  // Recheck after uploads: a moved tag must never publish an old bundle.
  await assertReleaseCommit(client, repository, release, commit);
  await client.json(`repos/${repository}/releases/${existing.id}`, { method: 'PATCH', body: { draft: false, make_latest: 'false' } });
  console.log(`插件发行完成：${release}（${catalog.plugins.length} 个插件，全部附件已下载复核）。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await publishPluginRelease({
    client: new GitHubReleaseClient(), repository: process.env.GITHUB_REPOSITORY,
    release: process.env.GITHUB_REF_NAME, commit: process.env.GITHUB_SHA,
    directory: process.argv[2] || 'dist/plugins/release',
  });
}
