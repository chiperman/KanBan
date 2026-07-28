import type { AssetSourceAuthorizationInput } from "@/server/asset-source-provider-adapters";
import {
  AssetSourceOnboardingError,
  type AssetSourceProvider,
} from "@/server/asset-source-onboarding";
import { getServices } from "@/server/composition";

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
  { invalid: string; unavailable: string; failed: string }
> = {
  longbridge: {
    invalid: "授权预览无效",
    unavailable: "授权预览已失效或正在确认，请重新开始",
    failed: "保存长桥来源失败",
  },
  binance: {
    invalid: "Binance 预览无效",
    unavailable: "Binance 预览已失效或正在确认，请重新验证",
    failed: "保存 Binance 来源失败",
  },
  okx: {
    invalid: "OKX 预览无效",
    unavailable: "OKX 预览已失效或正在确认，请重新验证",
    failed: "保存 OKX 来源失败",
  },
  bitget: {
    invalid: "Bitget 预览无效",
    unavailable: "Bitget 预览已失效或正在确认，请重新验证",
    failed: "保存 Bitget 来源失败",
  },
  ethereum: {
    invalid: "EVM 观察钱包预览无效",
    unavailable: "EVM 观察钱包预览已失效或正在确认，请重新验证",
    failed: "保存 EVM 观察钱包失败",
  },
  bsc: {
    invalid: "EVM 观察钱包预览无效",
    unavailable: "EVM 观察钱包预览已失效或正在确认，请重新验证",
    failed: "保存 EVM 观察钱包失败",
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

export function createConfirmRoute(
  providerFromRequest:
    | AssetSourceProvider
    | ((body: Record<string, unknown>) => AssetSourceProvider | null),
) {
  return async function POST(request: Request) {
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
      const unavailable =
        error instanceof AssetSourceOnboardingError &&
        error.code === "preview-unavailable";
      return Response.json(
        {
          error: unavailable
            ? messages.unavailable
            : error instanceof Error
              ? error.message
              : messages.failed,
        },
        { status: unavailable ? 409 : 500 },
      );
    }
  };
}
