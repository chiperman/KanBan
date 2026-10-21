import { rejectCrossOrigin } from "@/server/auth/request-origin";
import { getServices } from "@/server/composition";
import {
  InvalidManualAssetRecordError,
  parseCreateManualAssetSourceInput,
} from "@/domain/manual-asset-records";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }
  try {
    const input = parseCreateManualAssetSourceInput(
      await request.json().catch(() => null),
    );
    await services.manualAssetRecords.create(input);
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "手工资产记录保存失败",
      },
      {
        status: error instanceof InvalidManualAssetRecordError ? 400 : 500,
      },
    );
  }
  return Response.json({ ok: true });
}
