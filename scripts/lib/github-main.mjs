export async function assertMainCommit(client, repository, commit) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !/^[a-f0-9]{40}$/.test(commit || '')) {
    throw new Error('GitHub 仓库或目标提交无效');
  }
  const comparison = await client.json(`repos/${repository}/compare/${commit}...main`);
  if (!['ahead', 'identical'].includes(comparison.status) || comparison.merge_base_commit?.sha !== commit) {
    throw new Error('只能使用已经合入 main 的提交');
  }
  const runs = await client.json(`repos/${repository}/actions/workflows/main-build.yml/runs?head_sha=${commit}&event=push&branch=main&per_page=100`);
  const latest = runs.workflow_runs?.filter(r => r.head_sha === commit && r.head_branch === 'main' && r.event === 'push')
    .sort((a, b) => b.id - a.id)[0];
  if (!latest || latest.status !== 'completed' || latest.conclusion !== 'success') {
    throw new Error('目标提交的最新 Build main 尚未成功，请等待或修复主分支 CI 后重试');
  }
  return { runId: latest.id, runUrl: `https://github.com/${repository}/actions/runs/${latest.id}` };
}

export function gitHubRepository(remote) {
  const match = /^(?:git@github\.com:|https:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(remote);
  if (!match) throw new Error('手动部署需要 origin 指向 github.com 的项目仓库');
  return match[1];
}
