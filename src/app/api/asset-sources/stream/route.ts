import { getServices } from "@/server/composition";
import { getLongbridgeServeQuoteHub } from "@/server/asset-sources/longbridge-serve-client";
import { readCookie } from "@/server/auth/cookies";
import { lookupSession, onSessionInvalidated, SESSION_COOKIE } from "@/server/auth/session";

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
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || (await services.auth.currentSession()) === null) {
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
  let close = () => undefined as void;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unwatchSession = () => undefined as void;
      close = () => {
        if (closed) return;
        closed = true;
        subscription?.close();
        subscription = null;
        if (keepAlive !== null) clearInterval(keepAlive);
        keepAlive = null;
        unwatchSession();
        request.signal.removeEventListener("abort", close);
        try { controller.close(); } catch { /* Consumer may already have cancelled. */ }
      };
      const sessionValid = () => {
        if (closed) return false;
        if (lookupSession(token, services.clock.now()) !== null) return true;
        close();
        return false;
      };
      request.signal.addEventListener("abort", close, { once: true });
      unwatchSession = onSessionInvalidated(token, close);
      if (request.signal.aborted) close();
      if (!sessionValid()) return;
      controller.enqueue(event(encoder, "ready", {
        provider: "longbridge",
        symbols,
        mode: "serve",
      }));
      if (symbols.length > 0) {
        const send = (name: string, value: unknown) => {
          if (!sessionValid()) return;
          try {
            controller.enqueue(event(encoder, name, value));
          } catch {
            close();
          }
        };
        const created = getLongbridgeServeQuoteHub().subscribe(
          symbols,
          (quote) => send("quote", quote),
          (status) => send("stream-status", status),
        );
        // subscribe can synchronously replay quotes and invoke a close callback.
        if (closed) created.close(); else subscription = created;
      }
      if (closed) return;
      keepAlive = setInterval(() => {
        if (!sessionValid()) return;
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          close();
        }
      }, 20_000);
    },
    cancel() { close(); },
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
