import { getServices } from "@/server/composition";
import { getLongbridgeServeQuoteHub } from "@/server/asset-sources/longbridge-serve-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function event(encoder: TextEncoder, name: string, value: unknown): Uint8Array {
  return encoder.encode(
    "event: " + name + "\n" +
      "data: " + JSON.stringify(value) + "\n\n",
  );
}

export async function GET(request: Request): Promise<Response> {
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }

  const sources = await services.assetSources.list();
  const symbols = [...new Set(
    sources
      .filter((source) =>
        source.kind === "longbridge" &&
        source.lifecycle !== "disconnected" &&
        source.credentialReference !== null,
      )
      .flatMap((source) => source.snapshot.holdings)
      .map((holding) => holding.symbol)
      .filter((symbol) => symbol.length > 0 && !symbol.includes("CASH.")),
  )];

  const encoder = new TextEncoder();
  let subscription: { close(): void } | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        subscription?.close();
        subscription = null;
        if (keepAlive !== null) clearInterval(keepAlive);
        keepAlive = null;
      };
      request.signal.addEventListener("abort", close, { once: true });
      controller.enqueue(event(encoder, "ready", {
        provider: "longbridge",
        symbols,
        mode: "serve",
      }));
      if (symbols.length > 0) {
        const send = (name: string, value: unknown) => {
          try {
            controller.enqueue(event(encoder, name, value));
          } catch {
            close();
          }
        };
        subscription = getLongbridgeServeQuoteHub().subscribe(
          symbols,
          (quote) => send("quote", quote),
          (status) => send("stream-status", status),
        );
      }
      keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          close();
        }
      }, 20_000);
    },
    cancel() {
      subscription?.close();
      subscription = null;
      if (keepAlive !== null) clearInterval(keepAlive);
      keepAlive = null;
    },
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    },
  });
}
