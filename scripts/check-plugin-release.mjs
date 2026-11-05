import { execFileSync } from 'node:child_process';
import { GitHubReleaseClient, pluginReleasePattern, assertReleaseCommit, assertPublishedVersions, readReleaseBundle, verifyRemoteAssets } from './lib/plugin-release.mjs';

const [directory = 'dist/plugins/release'] = process.argv.slice(2);
const release = process.env.GITHUB_REF_NAME;
const repository = process.env.GITHUB_REPOSITORY;
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!pluginReleasePattern.test(release || '') || !/^[\w.-]+\/[\w.-]+$/.test(repository || '') ||
    process.env.GITHUB_SHA !== commit) throw new Error('请在插件标签对应的 GitHub Actions 提交中执行发行检查');
const client = new GitHubReleaseClient();
await assertReleaseCommit(client, repository, release, commit);
const { catalog, files } = readReleaseBundle(directory, repository, release, commit);
const existing = await client.json(`repos/${repository}/releases/tags/${encodeURIComponent(release)}`, { allow404: true });
if (existing && !existing.draft) await verifyRemoteAssets(client, repository, existing, files);
else await assertPublishedVersions(client, repository, catalog);
console.log(`发布前检查通过：${release} → ${commit}，已合入 main 且主分支 CI 成功，插件版本有效。`);
