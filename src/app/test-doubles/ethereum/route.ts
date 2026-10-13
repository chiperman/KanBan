import { getTestServices } from "@/server/composition";
import { testGuard } from "@/server/testing/route-support";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = testGuard();
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { scenario?: string; commitError?: string };
  const services = getTestServices();
  if (body.scenario === "refresh-ethereum-failure") {
    services.assetSynchronization.reset("evm-ethereum-refresh-failure");
    return Response.json({ ok: true });
  }
  if (body.scenario === "refresh-ethereum-price-failure") {
    services.assetSynchronization.reset("evm-ethereum-price-refresh-failure");
    return Response.json({ ok: true });
  }
  if (body.scenario === "refresh-passthrough") {
    services.assetSynchronization.reset("passthrough");
    return Response.json({ ok: true });
  }
  if (body.scenario === "refresh-unknown-valued") {
    services.assetSynchronization.reset("evm-unknown-valued");
    return Response.json({ ok: true });
  }
  if (body.scenario === "forget-credential") {
    const source = (await services.assetSources.list()).find(({ kind }) =>
      kind.startsWith("evm-watch-"),
    );
    if (!source?.credentialReference) {
      return Response.json({ error: "缺少 EVM 测试凭证" }, { status: 400 });
    }
    await services.secrets.remove(source.credentialReference);
    return Response.json({ ok: true });
  }
  services.evm.configure(body.scenario ?? "valid");
  services.assetSourceConnections.failNext(body.commitError);
  if ((await services.assetCards.list()).length === 0) {
    await services.assetCards.replaceAll([{
      id: "ethereum-test-private-card",
      kind: "asset",
      title: "资产",
      body: "仅供身份测试的安全占位",
      span: 1,
    }]);
  }
  return Response.json({ ok: true });
}

export async function GET() {
  const denied = testGuard();
  if (denied) return denied;
  const services = getTestServices();
  const sources = (await services.assetSources.list()).filter(({ kind }) =>
    kind.startsWith("evm-watch-"),
  );
  const cards = (await services.assetCards.list()).filter(
    (card) => card.kind === "asset" && card.sourceId !== undefined &&
      sources.some((source) => source.id === card.sourceId),
  );
  const snapshots = await services.dailyAssetSnapshots.list();
  return Response.json({
    savedSources: sources.length,
    savedSecrets: services.secrets.size(),
    sources: sources.map(({ id, kind, lifecycle = "connected" }) => ({
      id,
      kind,
      lifecycle,
    })),
    cards: cards.map((card) => card.kind === "asset"
      ? { sourceId: card.sourceId, hidden: card.hidden }
      : {}),
    refreshCalls: services.assetSynchronization.refresher.calls(),
    snapshotSourceIds: [
      ...new Set(snapshots.flatMap((snapshot) =>
        snapshot.sources.map(({ sourceId }) => sourceId),
      )),
    ],
    snapshots: snapshots.map(({ day, sources: snapshotSources }) => ({
      day,
      sourceIds: snapshotSources.map(({ sourceId }) => sourceId),
    })),
  });
}
