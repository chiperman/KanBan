import type { AssetSourceAuthorizationInput } from "@/server/asset-source-provider-adapters";
import {
  assetSourceProviderForKind,
  parseAssetSourceAuthorizationInput,
  parseAssetSourceReauthorizationInput,
} from "@/server/asset-source-authorization-inputs";
import {
  AssetSourceOnboardingError,
  type AssetSourceProvider,
} from "@/server/asset-source-onboarding";
import { getServices } from "@/server/composition";
import { rejectCrossOrigin } from "@/server/auth/request-origin";

interface PreviewRoute<Input extends AssetSourceAuthorizationInput> {
  provider: AssetSourceProvider;
  parse(body: unknown): Input | null;
  invalidInput: string;
  previewFailed: string;
  previewExpired: string;
  readable?: boolean;
}

const CONFIRM_MESSAGES: Record<
  AssetSourceProvider,
  { invalid: string; failed: string }
> = {
  longbridge: {
    invalid: "授权预览无效",
    failed: "保存长桥来源失败",
  },
  binance: {
    invalid: "Binance 预览无效",
    failed: "保存 Binance 来源失败",
  },
  okx: {
    invalid: "OKX 预览无效",
    failed: "保存 OKX 来源失败",
  },
  bitget: {
    invalid: "Bitget 预览无效",
    failed: "保存 Bitget 来源失败",
  },
  bit: {
    invalid: "BIT / Matrixport 预览无效",
    failed: "保存 BIT / Matrixport 来源失败",
  },
  ethereum: {
    invalid: "EVM 观察钱包预览无效",
    failed: "保存 EVM 观察钱包失败",
  },
  bsc: {
    invalid: "EVM 观察钱包预览无效",
    failed: "保存 EVM 观察钱包失败",
  },
};

const PREVIEW_MESSAGES: Record<
  AssetSourceProvider,
  { invalidInput: string; previewFailed: string; previewExpired: string }
> = {
  longbridge: {
    invalidInput: "授权预览无效",
    previewFailed: "长桥授权预览失败",
    previewExpired: "授权预览已失效，请重新开始",
  },
  binance: {
    invalidInput: "Binance API 凭证格式无效",
    previewFailed: "Binance 凭证验证失败",
    previewExpired: "Binance 预览已失效，请重新验证",
  },
  okx: {
    invalidInput: "OKX API 凭证格式无效",
    previewFailed: "OKX 凭证验证失败",
    previewExpired: "OKX 预览已失效，请重新验证",
  },
  bitget: {
    invalidInput: "Bitget API 凭证格式无效",
    previewFailed: "Bitget 凭证验证失败",
    previewExpired: "Bitget 预览已失效，请重新验证",
  },
  bit: {
    invalidInput: "BIT / Matrixport API 凭证格式无效",
    previewFailed: "BIT / Matrixport 凭证验证失败",
    previewExpired: "BIT / Matrixport 预览已失效，请重新验证",
  },
  ethereum: {
    invalidInput: "EVM 链或公开地址格式无效",
    previewFailed: "EVM 观察钱包预览失败",
    previewExpired: "EVM 观察钱包预览已失效，请重新验证",
  },
  bsc: {
    invalidInput: "EVM 链或公开地址格式无效",
    previewFailed: "EVM 观察钱包预览失败",
    previewExpired: "EVM 观察钱包预览已失效，请重新验证",
  },
};

async function ownerRequired(): Promise<Response | null> {
  return (await getServices().auth.currentSession()) === null
    ? Response.json({ error: "需要所有者身份" }, { status: 401 })
    : null;
}

export function createPreviewRoute<Input extends AssetSourceAuthorizationInput>(
  config: PreviewRoute<Input>,
) {
  return {
    POST: async (request: Request) => {
      const originError = rejectCrossOrigin(request);
      if (originError) return originError;
      const unauthorized = await ownerRequired();
      if (unauthorized) return unauthorized;
      const input = config.parse(await request.json().catch(() => null));
      if (!input) {
        return Response.json({ error: config.invalidInput }, { status: 400 });
      }
      const services = getServices();
      try {
        return Response.json(
          await services.assetSourceOnboarding.preview(
            config.provider,
            input,
            services.clock.now().toISOString(),
          ),
        );
      } catch (error) {
        return Response.json(
          {
            error:
              error instanceof Error ? error.message : config.previewFailed,
          },
          { status: 400 },
        );
      }
    },
    GET: config.readable
      ? async (request: Request) => {
          const unauthorized = await ownerRequired();
          if (unauthorized) return unauthorized;
          const preview = getServices().assetSourceOnboarding.publicPreview(
            config.provider,
            new URL(request.url).searchParams.get("id") ?? "",
          );
          return preview
            ? Response.json(preview)
            : Response.json(
                { error: config.previewExpired },
                { status: 404 },
              );
        }
      : undefined,
    DELETE: async (request: Request) => {
      const originError = rejectCrossOrigin(request);
      if (originError) return originError;
      const unauthorized = await ownerRequired();
      if (unauthorized) return unauthorized;
      getServices().assetSourceOnboarding.cancel(
        config.provider,
        new URL(request.url).searchParams.get("id") ?? "",
      );
      return Response.json({ ok: true });
    },
  };
}

export function createProviderPreviewRoute(
  provider: AssetSourceProvider,
  { readable = false }: { readable?: boolean } = {},
) {
  const messages = PREVIEW_MESSAGES[provider];
  return createPreviewRoute({
    provider,
    parse: (body) => parseAssetSourceAuthorizationInput(provider, body),
    ...messages,
    readable,
  });
}

async function reauthorizeSource(id: string) {
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return { response: Response.json({ error: "需要所有者身份" }, { status: 401 }) };
  }
  const source = (await services.assetSources.list()).find((item) => item.id === id);
  if (source === undefined) {
    return { response: Response.json({ error: "资产来源不存在" }, { status: 404 }) };
  }
  const provider = assetSourceProviderForKind(source.kind);
  if (provider === null) {
    return { response: Response.json({ error: "该来源不支持重新授权" }, { status: 400 }) };
  }
  return { services, source, provider };
}

export function createReauthorizePreviewRoute() {
  return {
    GET: async (
      request: Request,
      { params }: { params: Promise<{ id: string }> },
    ) => {
      const { id } = await params;
      const context = await reauthorizeSource(id);
      if ("response" in context) return context.response;
      const preview = context.services.assetSourceOnboarding.publicPreview(
        context.provider,
        new URL(request.url).searchParams.get("id") ?? "",
      );
      return preview === null
        ? Response.json({ error: "授权预览已失效，请重新验证" }, { status: 404 })
        : Response.json(preview);
    },
    POST: async (
      request: Request,
      { params }: { params: Promise<{ id: string }> },
    ) => {
      const originError = rejectCrossOrigin(request);
      if (originError) return originError;
      const { id } = await params;
      const context = await reauthorizeSource(id);
      if ("response" in context) return context.response;
      const input = parseAssetSourceReauthorizationInput(
        context.provider,
        await request.json().catch(() => null),
      );
      if (input === null) {
        return Response.json({ error: "重新授权材料格式无效" }, { status: 400 });
      }
      try {
        return Response.json(
          await context.services.assetSourceOnboarding.preview(
            context.provider,
            context.provider === "longbridge"
              ? { ...input, sourceId: context.source.id }
              : input,
            context.services.clock.now().toISOString(),
            {
              sourceId: context.source.id,
              expectedAccountId: context.source.accountId,
            },
          ),
        );
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : "重新授权校验失败" },
          { status: 400 },
        );
      }
    },
    DELETE: async (
      request: Request,
      { params }: { params: Promise<{ id: string }> },
    ) => {
      const originError = rejectCrossOrigin(request);
      if (originError) return originError;
      const { id } = await params;
      const context = await reauthorizeSource(id);
      if ("response" in context) return context.response;
      context.services.assetSourceOnboarding.cancel(
        context.provider,
        new URL(request.url).searchParams.get("id") ?? "",
      );
      return Response.json({ ok: true });
    },
  };
}

export function createConfirmRoute(
  providerFromRequest:
    | AssetSourceProvider
    | ((body: Record<string, unknown>) => AssetSourceProvider | null),
) {
  return async function POST(request: Request) {
    const originError = rejectCrossOrigin(request);
    if (originError) return originError;
    const unauthorized = await ownerRequired();
    if (unauthorized) return unauthorized;
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const provider =
      typeof providerFromRequest === "function"
        ? providerFromRequest(body ?? {})
        : providerFromRequest;
    if (!provider) {
      return Response.json(
        { error: "EVM 观察钱包预览无效" },
        { status: 400 },
      );
    }
    const messages = CONFIRM_MESSAGES[provider];
    if (typeof body?.id !== "string") {
      return Response.json({ error: messages.invalid }, { status: 400 });
    }
    const services = getServices();
    try {
      await services.assetSourceOnboarding.confirm(
        provider,
        body.id,
        services.clock.now().toISOString(),
      );
      return Response.json({ ok: true }, { status: 201 });
    } catch (error) {
      return assetSourceOnboardingErrorResponse(error, messages.failed);
    }
  };
}

export function assetSourceOnboardingErrorResponse(
  error: unknown,
  fallback: string,
  failureStatus = 500,
): Response {
  const code = error instanceof AssetSourceOnboardingError ? error.code : undefined;
  return Response.json(
    { error: error instanceof Error ? error.message : fallback, ...(code ? { code } : {}) },
    { status: code === "preview-unavailable" || code === "preview-busy" ? 409 : failureStatus },
  );
}
