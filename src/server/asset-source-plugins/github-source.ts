import { PluginManagementError } from './installation';

export function parseGitHubPluginSource(source: string): { repository: string; release?: string } {
  if (typeof source !== 'string' || source.length > 500) throw new PluginManagementError('请输入 GitHub 仓库或 Release 地址');
  let value = source.trim().replace(/^github:/, '');
  if (value.startsWith('https://')) {
    let url: URL;
    try { url = new URL(value); } catch { throw new PluginManagementError('GitHub 地址格式无效'); }
    if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash) throw new PluginManagementError('请使用公开的 github.com 仓库或 Release 地址');
    value = url.pathname.replace(/^\//, '').replace(/\/$/, '');
  }
  const match = /^([a-zA-Z0-9][\w.-]*\/[a-zA-Z0-9][\w.-]*?)(?:\/releases\/tag\/([a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}))?$/.exec(value);
  if (!match || match[1].length > 200) throw new PluginManagementError('请输入 owner/repo 或 https://github.com/owner/repo/releases/tag/v1.0.0');
  return { repository: match[1].replace(/\.git$/, ''), ...(match[2] ? { release: match[2] } : {}) };
}
