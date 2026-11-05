import { getServices } from '@/server/composition';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const services = getServices();
  if (await services.auth.currentSession() === null) return Response.json({ error: '需要所有者身份' }, { status: 401 });
  if (!services.pluginManagement) return Response.json({ error: '当前运行环境不支持官方集成' }, { status: 503 });
  try {
    return Response.json(services.pluginManagement.status());
  } catch { return Response.json({ error: '无法读取官方集成信息，请重试' }, { status: 500 }); }
}
