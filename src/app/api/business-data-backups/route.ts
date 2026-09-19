import { getServices } from "@/server/composition";

export const dynamic = "force-dynamic";

type BackupRequest = {
  action?: unknown;
  fileName?: unknown;
  discardConfirmation?: unknown;
};

export async function POST(request: Request) {
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as BackupRequest | null;
  try {
    if (body?.action === "export") {
      return Response.json(await services.businessDataBackups.exportBackup());
    }
    if (
      (body?.action === "preview" || body?.action === "restore") &&
      typeof body.fileName === "string"
    ) {
      const result = body.action === "preview"
        ? await services.businessDataBackups.previewRestore(body.fileName)
        : await services.businessDataBackups.restore(body.fileName, typeof body.discardConfirmation === "string" ? body.discardConfirmation : undefined);
      return Response.json(result);
    }
    return Response.json({ error: "备份操作无效" }, { status: 400 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "备份操作失败" },
      { status: 400 },
    );
  }
}
