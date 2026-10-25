import { cookies } from "next/headers";

import type { AssetSourceSummary } from "@/server/ports";
import { readAssetRefreshState } from "@/server/refresh/asset-refresh-state";
import {
  DEFAULT_PROFIT_COLOR_SCHEME,
  isProfitColorScheme,
  PROFIT_COLOR_SCHEME_COOKIE_KEY,
} from "@/ui/profit-color-scheme";

export async function readSavedProfitColorScheme() {
  const saved = (await cookies()).get(PROFIT_COLOR_SCHEME_COOKIE_KEY)?.value ?? null;
  return isProfitColorScheme(saved) ? saved : null;
}

export async function readProfitColorScheme() {
  return (await readSavedProfitColorScheme()) ?? DEFAULT_PROFIT_COLOR_SCHEME;
}

export function assetRefreshRegistration(
  state: Awaited<ReturnType<typeof readAssetRefreshState>> | undefined,
  sources: readonly AssetSourceSummary[],
) {
  if (state === undefined) return undefined;
  return {
    ...state,
    sources: sources.map((source) => ({
      id: source.id,
      kind: source.kind,
      lifecycle: source.lifecycle,
      credentialAvailable: source.credentialReference !== null,
    })),
  };
}
