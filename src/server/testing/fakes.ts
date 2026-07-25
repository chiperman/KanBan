import type {
  AssetSourceSummary,
  AssetSources,
  Card,
  CardStore,
  Clock,
  OwnerAuth,
  OwnerSession,
  Prices,
  PriceQuote,
  SecretStore,
} from "@/server/ports";
import type { AppServices } from "@/server/composition";

export class FakeClock implements Clock {
  private current = new Date("2026-01-01T00:00:00.000Z");

  now(): Date {
    return this.current;
  }

  set(iso: string): void {
    this.current = new Date(iso);
  }
}

export class InMemoryCardStore implements CardStore {
  private cards: Card[] = [];

  async list(): Promise<Card[]> {
    return this.cards;
  }

  async replaceAll(cards: Card[]): Promise<void> {
    this.cards = cards;
  }
}

export class FakeAssetSources implements AssetSources {
  async list(): Promise<AssetSourceSummary[]> {
    return [];
  }
}

export class FakePrices implements Prices {
  async quote(): Promise<PriceQuote | null> {
    return null;
  }
}

export class FakeOwnerAuth implements OwnerAuth {
  async currentSession(): Promise<OwnerSession | null> {
    return null;
  }
}

export class InMemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();
  private sequence = 0;

  async put(value: string): Promise<string> {
    this.sequence += 1;
    const reference = `test-secret-${this.sequence}`;
    this.values.set(reference, value);
    return reference;
  }

  async get(reference: string): Promise<string | null> {
    return this.values.get(reference) ?? null;
  }

  async remove(reference: string): Promise<void> {
    this.values.delete(reference);
  }
}

export interface TestServices extends AppServices {
  clock: FakeClock;
  cards: InMemoryCardStore;
  assetSources: FakeAssetSources;
  prices: FakePrices;
  auth: FakeOwnerAuth;
  secrets: InMemorySecretStore;
}

export function createTestServices(): TestServices {
  return {
    clock: new FakeClock(),
    cards: new InMemoryCardStore(),
    assetSources: new FakeAssetSources(),
    prices: new FakePrices(),
    auth: new FakeOwnerAuth(),
    secrets: new InMemorySecretStore(),
  };
}
