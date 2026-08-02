import { getTestServices, isTestEnv } from "@/server/composition";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
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
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
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
