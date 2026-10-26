import { getServices } from '@/server/composition';
import { rejectCrossOrigin } from '@/server/auth/request-origin';
import { PluginManagementError } from '@/server/asset-source-plugins/installation';
import type { PluginManagementAction } from '@/domain/plugin-management';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const services = getServices();
  if (await services.auth.currentSession() === null) return Response.json({ error: '需要所有者身份' }, { status: 401 });
  if (!services.pluginManagement) return Response.json({ error: '当前运行环境不支持插件管理' }, { status: 503 });
  try {
    return Response.json(new URL(request.url).searchParams.get('catalog') === '1'
      ? await services.pluginManagement.available(new URL(request.url).searchParams.get('refresh') === '1') : services.pluginManagement.status());
  } catch (e) { return failure(e); }
}
export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request); if (originError) return originError;
  const services = getServices();
  if (await services.auth.currentSession() === null) return Response.json({ error: '需要所有者身份' }, { status: 401 });
  if (!services.pluginManagement) return Response.json({ error: '当前运行环境不支持插件管理' }, { status: 503 });
  const body = await request.json().catch(() => null) as { action?: unknown; id?: unknown; version?: unknown; repository?: unknown; sha256?: unknown } | null;
  if (!body || typeof body.action !== 'string' || !['install', 'update', 'enable', 'disable', 'uninstall', 'rollback'].includes(body.action) || typeof body.id !== 'string' || body.id.length > 128 || (body.version !== undefined && typeof body.version !== 'string')) return Response.json({ error: '插件操作无效' }, { status: 400 });
  if ((body.repository !== undefined && (typeof body.repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(body.repository))) || (body.sha256 !== undefined && (typeof body.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(body.sha256)))) return Response.json({ error: '插件发布来源无效' }, { status: 400 });
  try { return Response.json(await services.pluginManagement.change(body.action as PluginManagementAction, body.id, body.version as string | undefined, undefined, { repository: body.repository as string | undefined, sha256: body.sha256 as string | undefined })); }
  catch (e) { return failure(e); }
}
function failure(e: unknown) {
  return Response.json({ error: e instanceof PluginManagementError ? e.message : '插件操作失败，请检查插件文件和发行目录后重试' }, { status: 400 });
}
