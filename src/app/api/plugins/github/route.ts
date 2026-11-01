import { getServices } from '@/server/composition';
import { rejectCrossOrigin } from '@/server/auth/request-origin';
import { PluginManagementError } from '@/server/asset-source-plugins/installation';
import { pluginManagementFailure } from '@/server/asset-source-plugins/http-response';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request); if (originError) return originError;
  const services = getServices();
  if (await services.auth.currentSession() === null) return Response.json({ error: '需要所有者身份' }, { status: 401 });
  if (!services.pluginManagement) return Response.json({ error: '当前运行环境不支持插件管理' }, { status: 503 });
  const body = await request.json().catch(() => null) as { action?: unknown; source?: unknown; id?: unknown; version?: unknown; repository?: unknown; sha256?: unknown } | null;
  if (!body || typeof body.source !== 'string' || body.source.length > 500 || !['inspect', 'install'].includes(String(body.action))) return Response.json({ error: '请输入 GitHub 仓库或 Release 地址' }, { status: 400 });
  try {
    if (body.action === 'inspect') return Response.json(await services.pluginManagement.inspectGitHub(body.source));
    if (typeof body.id !== 'string' || body.id.length > 128 || typeof body.version !== 'string' || body.version.length > 100 || typeof body.repository !== 'string' || body.repository.length > 200 || typeof body.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(body.sha256)) throw new PluginManagementError('请先查看插件并确认安装信息');
    return Response.json(await services.pluginManagement.installGitHub(body.source, body.id, { version: body.version, repository: body.repository, sha256: body.sha256 }));
  } catch (error) {
    return pluginManagementFailure(error, '无法读取或安装此仓库的插件，请核对当前状态或联系开发者');
  }
}
