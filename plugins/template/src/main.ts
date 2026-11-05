import manifest from "../manifest.json" with { type: "json" };
import { serveAssetSourcePlugin } from "../../sdk/stdio-server";
import type { AssetSourcePluginManifest } from "../../sdk/protocol";
import { createAuthorization, readSnapshot } from "./provider";

/**
 * Minimal current-protocol entry point.
 * Replace provider.ts with a real read-only implementation before use.
 */
serveAssetSourcePlugin(() => ({
  manifest: manifest as AssetSourcePluginManifest,
  read: async (request, context) => ({
    snapshot: await readSnapshot(
      JSON.parse(request.credentials) as Record<string, unknown>,
      request.attemptedAt,
      context.signal,
    ),
  }),
  authorize: async (input, observedAt, context) =>
    createAuthorization(input, observedAt, context.signal),
  revalidate: async (authorization, observedAt, context) =>
    createAuthorization(
      JSON.parse(authorization.credentials) as Record<string, unknown>,
      observedAt,
      context.signal,
    ),
}));
