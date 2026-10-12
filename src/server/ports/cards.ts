export type CardSpan = 1 | 2 | 3;

export interface AssetCard {
  id: string;
  kind: "asset";
  title: string;
  body: string;
  sourceId?: string;
  hidden?: boolean;
  span: CardSpan;
  /** 从新行开始，避免自动网格填补上一行的空位。 */
  startsNewRow?: boolean;
}

export type Card = AssetCard;

export interface AssetCardStore {
  list(): Promise<Card[]>;
  replaceAll(cards: Card[]): Promise<void>;
}
