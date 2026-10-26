import type { CardSpan, AssetCard, Card } from "@/domain/asset-cards";
export type { CardSpan, AssetCard, Card } from "@/domain/asset-cards";

export interface AssetCardStore {
  list(): Promise<Card[]>;
  replaceAll(cards: Card[]): Promise<void>;
}
