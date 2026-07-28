import {
  AssetSourceOnboarding,
  type AssetSourceAuthorization,
  type AssetSourceProviderAdapter,
} from "@/server/asset-source-onboarding";
import { isTestEnv } from "@/server/composition";

export const dynamic = "force-dynamic";

const AUTHORIZATION: AssetSourceAuthorization = {
  provider: "binance",
  credentials: "server-only-secret",
  permissions: ["account", "positions"],
  account: { id: "account-one", label: "测试账户" },
  snapshot: {
    total: { amount: "10", currency: "USD" },
    holdings: [],
    exchangeRates: [],
    syncedAt: "2026-07-28T00:00:00.000Z",
  },
};

export async function POST(request: Request) {
  if (!isTestEnv()) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  const action = new URL(request.url).searchParams.get("action");
  const connected: string[] = [];
  let now = 0;
  let failCommit = action === "commit-failed";
  const adapter: AssetSourceProviderAdapter = {
    provider: "binance",
    async authorize() {
      if (action === "permission-denied") throw new Error("检测到写权限");
      return AUTHORIZATION;
    },
    async revalidate() {
      return action === "identity-changed"
        ? {
            ...AUTHORIZATION,
            account: { id: "account-two", label: "另一测试账户" },
          }
        : AUTHORIZATION;
    },
    async connect(result) {
      if (failCommit) {
        failCommit = false;
        throw new Error("原子事务写入失败");
      }
      connected.push(result.account.id);
    },
  };
  const onboarding = new AssetSourceOnboarding([adapter], () => now, 1_000);
  let preview;
  try {
    preview = await onboarding.preview(
      "binance",
      { apiKey: "key", apiSecret: "secret" },
      "2026-07-28T00:00:00.000Z",
    );
  } catch (error) {
    return Response.json({
      rejected: true,
      error: error instanceof Error ? error.message : "验证失败",
      connected: connected.length,
    });
  }
  const credentialLeaked = JSON.stringify(preview).includes("server-only-secret");

  const confirm = () =>
    onboarding.confirm(
      "binance",
      preview.id,
      "2026-07-28T00:01:00.000Z",
    );

  if (action === "expired") {
    now = 1_001;
    try {
      await confirm();
    } catch (error) {
      return Response.json({
        rejected: true,
        error: error instanceof Error ? error.message : "确认失败",
        connected: connected.length,
      });
    }
  }

  if (action === "duplicate") {
    await confirm();
    let secondRejected = false;
    try {
      await confirm();
    } catch {
      secondRejected = true;
    }
    return Response.json({
      firstConfirmed: true,
      secondRejected,
      connected: connected.length,
    });
  }

  if (action === "identity-changed") {
    try {
      await confirm();
    } catch (error) {
      return Response.json({
        rejected: true,
        error: error instanceof Error ? error.message : "确认失败",
        connected: connected.length,
      });
    }
  }

  if (action === "commit-failed") {
    let firstRejected = false;
    try {
      await confirm();
    } catch {
      firstRejected = true;
    }
    await confirm();
    return Response.json({
      firstRejected,
      retryConfirmed: true,
      connected: connected.length,
    });
  }

  if (action === "concurrent") {
    const results = await Promise.allSettled([confirm(), confirm()]);
    return Response.json({
      confirmed: results.filter(({ status }) => status === "fulfilled").length,
      rejected: results.filter(({ status }) => status === "rejected").length,
      connected: connected.length,
    });
  }

  if (action !== "success") {
    return Response.json({ error: "unknown action" }, { status: 400 });
  }
  await confirm();

  const { id: _id, ...publicPreview } = preview;
  return Response.json({
    preview: publicPreview,
    connected,
    credentialLeaked,
    previewRemoved: onboarding.publicPreview("binance", preview.id) === null,
  });
}
