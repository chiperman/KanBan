import type { AssetSourceSummary } from "@/server/ports";
import type { AppServices } from "@/server/composition";
import { InvalidSourceInvestmentRecordError, parseSourceInvestmentRecordInput } from "@/domain/source-investment-records";
import { InvalidEvmTokenPreferenceError } from "@/domain/evm-token-preferences";
import {
  InvalidManualAssetRecordError,
  parseManualAssetClass,
  parseManualAssetRecordDay,
  parseManualAssetRecordInput,
} from "@/domain/manual-asset-records";
import { InvalidAssetSourceDisplayNameError } from "@/domain/asset-source-display-name";

export interface AssetSourceCommandBody {
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
  recordId?: unknown;
  confirmation?: unknown;
}

export class AssetSourceCommandError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export function parseAssetSourceCommandBody(
  value: unknown,
): AssetSourceCommandBody | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as AssetSourceCommandBody
    : null;
}

type SourceCommandContext = {
  id: string;
  services: AppServices;
  source: AssetSourceSummary;
};

function requireDetails(services: AppServices) {
  if (!services.assetSourceDetails) {
    throw new Error("来源详情服务不可用");
  }
  return services.assetSourceDetails;
}

export async function executeAssetSourcePatch(
  context: SourceCommandContext,
  body: AssetSourceCommandBody | null,
): Promise<boolean> {
  if (body?.action === "visibility" && typeof body.hidden === "boolean") {
    await context.services.assetSourceLifecycle.setHidden(context.id, body.hidden);
    return true;
  }
  if (body?.action === "rename" && typeof body.displayName === "string") {
    await context.services.assetSourceLifecycle.setDisplayName(
      context.id,
      body.displayName,
    );
    return true;
  }
  if (
    body?.action === "evm-token-preference" &&
    Array.isArray(body.assetKeys) &&
    body.assetKeys.every((assetKey) => typeof assetKey === "string") &&
    (body.status === "included" || body.status === "ignored" || body.status === "unrecognized")
  ) {
    await context.services.assetSourceLifecycle.setEvmTokenPreference(
      context.id,
      body.assetKeys,
      body.status,
    );
    return true;
  }
  if (body?.action === "manual-record") {
    if (context.source.kind !== "manual") {
      throw new AssetSourceCommandError("只有手工资产记录可以编辑今日总额");
    }
    await context.services.manualAssetRecords.record(
      context.id,
      parseManualAssetRecordInput(body),
    );
    return true;
  }
  if (body?.action === "investment-record") {
    const capturedAt = context.services.clock.now().toISOString();
    await requireDetails(context.services).saveSourceInvestmentRecord(
      context.id,
      parseSourceInvestmentRecordInput(body, capturedAt),
      capturedAt,
    );
    return true;
  }
  if (body?.action === "manual-asset-class") {
    if (context.source.kind !== "manual") {
      throw new AssetSourceCommandError("只有手工资产来源可以设置资产类别");
    }
    await context.services.assetSourceLifecycle.setManualAssetClass(
      context.id,
      parseManualAssetClass(body.manualAssetClass),
    );
    return true;
  }
  if (body?.action === "disconnect") {
    if (context.source.kind === "manual") {
      throw new AssetSourceCommandError("手工资产记录不支持断开");
    }
    await context.services.assetSourceLifecycle.disconnect(context.id);
    return true;
  }
  if (body?.action === "restore") {
    if (context.source.kind === "manual") {
      throw new AssetSourceCommandError("手工资产记录不支持恢复连接");
    }
    await context.services.assetSourceLifecycle.restore(context.id);
    return true;
  }
  if (body?.action === "reauthorize-evm") {
    const provider = context.source.kind === "evm-watch-ethereum"
      ? "ethereum"
      : context.source.kind === "evm-watch-bsc"
        ? "bsc"
        : null;
    if (!provider) {
      throw new AssetSourceCommandError("只有 EVM 观察钱包可以重新输入公开地址");
    }
    if (
      !Array.isArray(body.addresses) ||
      !body.addresses.every((address) => typeof address === "string")
    ) {
      throw new AssetSourceCommandError("EVM 公开地址格式无效");
    }
    await context.services.assetSourceOnboarding.reauthorize(
      provider,
      { provider, addresses: body.addresses },
      context.id,
      context.services.clock.now().toISOString(),
      context.source.accountId,
    );
    return true;
  }
  return false;
}

export async function executeAssetSourceDelete(
  context: SourceCommandContext,
  body: AssetSourceCommandBody | null,
): Promise<"handled" | "source-data"> {
  if (body?.action === "manual-record") {
    if (context.source.kind !== "manual") {
      throw new AssetSourceCommandError("只有手工资产记录可以删除");
    }
    await context.services.manualAssetRecords.delete(
      context.id,
      parseManualAssetRecordDay(body.day),
    );
    return "handled";
  }
  if (body?.action === "investment-record") {
    if (typeof body.recordId !== "string") {
      throw new InvalidSourceInvestmentRecordError("记录 ID 无效");
    }
    await requireDetails(context.services).deleteSourceInvestmentRecord(
      context.id,
      body.recordId,
    );
    return "handled";
  }
  if (body?.confirmation !== "DELETE_SOURCE_DATA") {
    throw new AssetSourceCommandError("必须明确确认永久删除");
  }
  await context.services.assetSourceLifecycle.deleteData(context.id);
  return "source-data";
}

export function isAssetSourceCommandInputError(error: unknown): boolean {
  return error instanceof AssetSourceCommandError ||
    error instanceof InvalidAssetSourceDisplayNameError ||
    error instanceof InvalidEvmTokenPreferenceError ||
    error instanceof InvalidManualAssetRecordError ||
    error instanceof InvalidSourceInvestmentRecordError;
}
