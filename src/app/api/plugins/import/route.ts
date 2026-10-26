import { getServices } from '@/server/composition';
import { rejectCrossOrigin } from '@/server/auth/request-origin';
import { inspectPluginArchive, MAX_PLUGIN_ARCHIVE } from '@/server/asset-source-plugins/import-package';
import { PluginManagementError } from '@/server/asset-source-plugins/installation';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request); if (originError) return originError;
  const services = getServices();
  if (await services.auth.currentSession() === null) return Response.json({ error: '需要所有者身份' }, { status: 401 });
  if (!services.pluginManagement) return Response.json({ error: '当前运行环境不支持插件管理' }, { status: 503 });
  try {
    const limit = MAX_PLUGIN_ARCHIVE + 64 * 1024;
    if (Number(request.headers.get('content-length')) > limit || !request.body) throw new PluginManagementError('插件包不能超过 16 MiB');
    const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break;
        size += value.length; if (size > limit) throw new PluginManagementError('插件包不能超过 16 MiB'); chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    const form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': request.headers.get('content-type') ?? '' } }).formData();
    const file = form.get('file'), action = form.get('action');
    if (!(file instanceof File) || file.size > MAX_PLUGIN_ARCHIVE || !['inspect', 'install'].includes(String(action))) throw new PluginManagementError('请选择 .tar.gz 插件包');
    const archive = Buffer.from(await file.arrayBuffer()), info = inspectPluginArchive(archive);
    if (action === 'inspect') return Response.json(info);
    if (form.get('sha256') !== info.sha256 || form.get('trusted') !== 'true') throw new PluginManagementError('请先查看并确认此插件包');
    await services.pluginManagement.installer.install({ archive });
    return Response.json(services.pluginManagement.status());
  } catch (e) {
    return Response.json({ error: e instanceof PluginManagementError ? e.message : '插件导入失败，请检查插件包后重试' }, { status: 400 });
  }
}
