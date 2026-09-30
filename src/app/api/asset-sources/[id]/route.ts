import { getServices } from "@/server/composition";
import { InvalidAssetSourceDisplayNameError } from "@/domain/asset-source-display-name";
import { InvalidSourceInvestmentRecordError, parseSourceInvestmentRecordInput } from "@/domain/source-investment-records";
import { InvalidEvmTokenPreferenceError } from "@/domain/evm-token-preferences";
import {
  InvalidManualAssetRecordError,
  parseManualAssetClass,
  parseManualAssetRecordDay,
  parseManualAssetRecordInput,
} from "@/domain/manual-asset-records";

export const dynamic = "force-dynamic";

async function ownerServices() {
  const services = getServices();
  return (await services.auth.currentSession()) === null ? null : services;
}

async function existingSource(id: string) {
  const services = await ownerServices();
  if (!services) return { response: Response.json({ error: "需要所有者身份" }, { status: 401 }) };
  const source = (await services.assetSources.list()).find((item) => item.id === id);
  if (!source) return { response: Response.json({ error: "资产来源不存在" }, { status: 404 }) };
  return { services, source };
}

function rejectCrossOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({ error: "请求来源不匹配" }, { status: 403 });
  }
  return null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const { id } = await params;
  const context = await existingSource(id);
  if ("response" in context) return context.response;
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    displayName?: unknown;
    hidden?: unknown;
    assetKeys?: unknown;
    status?: unknown;
    amount?: unknown;
    currency?: unknown;
    day?: unknown;
    manualAssetClass?: unknown;
    addresses?: unknown;
    id?: unknown;
    kind?: unknown;
  } | null;

  try {
    if (body?.action === "visibility" && typeof body.hidden === "boolean") {
      await context.services.assetSourceLifecycle.setHidden(id, body.hidden);
    } else if (
      body?.action === "rename" &&
      typeof body.displayName === "string"
    ) {
      await context.services.assetSourceLifecycle.setDisplayName(
        id,
        body.displayName,
      );
    } else if (
      body?.action === "evm-token-preference" &&
      Array.isArray(body.assetKeys) &&
      body.assetKeys.every((assetKey) => typeof assetKey === "string") &&
      (
        body.status === "included" ||
        body.status === "ignored" ||
        body.status === "unrecognized"
      )
    ) {
      await context.services.assetSourceLifecycle.setEvmTokenPreference(
        id,
        body.assetKeys,
        body.status,
      );
    } else if (body?.action === "manual-record") {
      if (context.source.kind !== "manual") {
        return Response.json(
          { error: "只有手工资产记录可以编辑今日总额" },
          { status: 400 },
        );
      }
      await context.services.manualAssetRecords.record(
        id,
        parseManualAssetRecordInput(body),
      );
    } else if (body?.action === "investment-record") {
      const capturedAt = context.services.clock.now().toISOString();
      await context.services.assetSourceDetails!.saveSourceInvestmentRecord(id, parseSourceInvestmentRecordInput(body, capturedAt), capturedAt);
    } else if (body?.action === "manual-asset-class") {
      if (context.source.kind !== "manual") {
        return Response.json(
          { error: "只有手工资产来源可以设置资产类别" },
          { status: 400 },
        );
      }
      await context.services.assetSourceLifecycle.setManualAssetClass(
        id,
        parseManualAssetClass(body.manualAssetClass),
      );
    } else if (body?.action === "disconnect") {
      if (context.source.kind === "manual") {
        return Response.json(
          { error: "手工资产记录不支持断开" },
          { status: 400 },
        );
      }
      await context.services.assetSourceLifecycle.disconnect(id);
    } else if (body?.action === "restore") {
      if (context.source.kind === "manual") {
        return Response.json(
          { error: "手工资产记录不支持恢复连接" },
          { status: 400 },
        );
      }
      await context.services.assetSourceLifecycle.restore(id);
    } else if (body?.action === "reauthorize-evm") {
      const provider = context.source.kind === "evm-watch-ethereum"
        ? "ethereum"
        : context.source.kind === "evm-watch-bsc"
          ? "bsc"
          : null;
      if (!provider) {
        return Response.json(
          { error: "只有 EVM 观察钱包可以重新输入公开地址" },
          { status: 400 },
        );
      }
      if (
        !Array.isArray(body.addresses) ||
        !body.addresses.every((address) => typeof address === "string")
      ) {
        return Response.json({ error: "EVM 公开地址格式无效" }, { status: 400 });
      }
      await context.services.assetSourceOnboarding.reauthorize(
        provider,
        { provider, addresses: body.addresses },
        id,
        context.services.clock.now().toISOString(),
        context.source.accountId,
      );
    } else {
      return Response.json({ error: "来源操作无效" }, { status: 400 });
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "来源操作失败" },
      {
        status:
          error instanceof InvalidAssetSourceDisplayNameError ||
            error instanceof InvalidEvmTokenPreferenceError ||
            error instanceof InvalidManualAssetRecordError ||
            error instanceof InvalidSourceInvestmentRecordError
            ? 400
            : 500,
      },
    );
  }
  return Response.json({ ok: true });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const { id } = await params;
  const context = await existingSource(id);
  if ("response" in context) return context.response;
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    day?: unknown;
    confirmation?: unknown;
    recordId?: unknown;
  } | null;
  if (body?.action === "manual-record") {
    try {
      if (context.source.kind !== "manual") {
        return Response.json(
          { error: "只有手工资产记录可以删除" },
          { status: 400 },
        );
      }
      await context.services.manualAssetRecords.delete(
        id,
        parseManualAssetRecordDay(body.day),
      );
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "删除手工资产记录失败" },
        {
          status: error instanceof InvalidManualAssetRecordError ? 400 : 500,
        },
      );
    }
    return Response.json({ ok: true });
  }
  if (body?.action === "investment-record") {
    try {
      if (typeof body.recordId !== "string") throw new InvalidSourceInvestmentRecordError("记录 ID 无效");
      await context.services.assetSourceDetails!.deleteSourceInvestmentRecord(id, body.recordId);
      return Response.json({ ok: true });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "删除来源投资记录失败" },
        { status: error instanceof InvalidSourceInvestmentRecordError ? 400 : 500 });
    }
  }
  if (body?.confirmation !== "DELETE_SOURCE_DATA") {
    return Response.json({ error: "必须明确确认永久删除" }, { status: 400 });
  }
  try {
    await context.services.assetSourceLifecycle.deleteData(id);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "永久删除失败" },
      { status: 500 },
    );
  }
  return Response.json({ ok: true });
}
