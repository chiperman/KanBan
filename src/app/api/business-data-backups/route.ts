import { getServices } from "@/server/composition";
import { rejectCrossOrigin } from "@/server/auth/request-origin";
import { MAX_BACKUP_CONTENTS_BYTES } from "@/server/backup/business-data-backup";
import type { AppServices } from "@/server/app-services";

export const dynamic = "force-dynamic";

type BackupRequest = {
  action?: unknown;
  fileName?: unknown;
  discardConfirmation?: unknown;
};

const backupError = (error: unknown) => Response.json(
  { error: error instanceof Error ? error.message : "备份操作失败" },
  { status: 400 },
);

/** 上传使用 multipart，避免将备份文件再编码为 base64。 */
async function handleImport(request: Request, services: AppServices) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "请先选择备份文件" }, { status: 400 });
  }
  if (file.size > MAX_BACKUP_CONTENTS_BYTES) {
    return Response.json(
      { error: `备份文件超过 ${MAX_BACKUP_CONTENTS_BYTES / (1024 * 1024)} MB` },
      { status: 400 },
    );
  }
  return Response.json(
    await services.businessDataBackups.importBackup({
      contents: await file.text(),
      fileName: file.name,
    }),
  );
}

export async function GET() {
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }
  try {
    return Response.json(
      { backups: await services.businessDataBackups.listBackups() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return backupError(error);
  }
}

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.startsWith("multipart/form-data")) {
      return await handleImport(request, services);
    }

    const body = (await request.json().catch(() => null)) as BackupRequest | null;
    if (body?.action === "export") {
      return Response.json(await services.businessDataBackups.exportBackup());
    }
    if (body?.action === "list") {
      return Response.json({ backups: await services.businessDataBackups.listBackups() });
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
    return backupError(error);
  }
}
