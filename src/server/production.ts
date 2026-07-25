import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  AppServices,
  Card,
} from "@/server/composition";
import type {
  AssetSourceSummary,
  AssetSources,
  CardStore,
  Clock,
  OwnerAuth,
  OwnerCredential,
  OwnerCredentialStore,
  Prices,
  PriceQuote,
  SecretStore,
} from "@/server/ports";
import { SessionOwnerAuth } from "@/server/auth/session-auth";

class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

function isCard(value: unknown): value is Card {
  if (typeof value !== "object" || value === null) return false;
  const card = value as Record<string, unknown>;
  return (
    typeof card.id === "string" &&
    typeof card.title === "string" &&
    typeof card.body === "string" &&
    (card.span === 1 || card.span === 2 || card.span === 3) &&
    (card.access === "public" || card.access === "restricted")
  );
}

export function parseCards(value: unknown): Card[] | null {
  if (!Array.isArray(value) || !value.every(isCard)) return null;
  return value;
}

class FileCardStore implements CardStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<Card[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch {
      return [];
    }
    const cards = parseCards(JSON.parse(raw));
    if (cards === null) {
      throw new Error(`卡片数据文件格式无效: ${this.filePath}`);
    }
    return cards;
  }

  async replaceAll(cards: Card[]): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(cards, null, 2), "utf8");
  }
}

/** 首版尚无已连接的资产来源。 */
class EmptyAssetSources implements AssetSources {
  async list(): Promise<AssetSourceSummary[]> {
    return [];
  }
}

/** 首版尚未接入参考价格来源；无可靠价格时一律返回 null。 */
class NoPrices implements Prices {
  async quote(): Promise<PriceQuote | null> {
    return null;
  }
}

function isOwnerCredential(value: unknown): value is OwnerCredential {
  if (typeof value !== "object" || value === null) return false;
  const credential = value as Record<string, unknown>;
  return (
    typeof credential.id === "string" &&
    typeof credential.publicKey === "string" &&
    typeof credential.counter === "number"
  );
}

class FileOwnerCredentialStore implements OwnerCredentialStore {
  constructor(private readonly filePath: string) {}

  async get(): Promise<OwnerCredential | null> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch {
      return null;
    }
    const value: unknown = JSON.parse(raw);
    if (!isOwnerCredential(value)) {
      throw new Error(`所有者凭证文件格式无效: ${this.filePath}`);
    }
    return value;
  }

  async save(credential: OwnerCredential): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(credential, null, 2), "utf8");
  }
}

class FileSecretStore implements SecretStore {
  constructor(private readonly filePath: string) {}

  private async readAll(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await readFile(this.filePath, "utf8")) as Record<
        string,
        string
      >;
    } catch {
      return {};
    }
  }

  private async writeAll(values: Record<string, string>): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(values, null, 2), "utf8");
  }

  async put(value: string): Promise<string> {
    const values = await this.readAll();
    const reference = randomUUID();
    values[reference] = value;
    await this.writeAll(values);
    return reference;
  }

  async get(reference: string): Promise<string | null> {
    const values = await this.readAll();
    return values[reference] ?? null;
  }

  async remove(reference: string): Promise<void> {
    const values = await this.readAll();
    delete values[reference];
    await this.writeAll(values);
  }
}

export function createProductionServices(): AppServices {
  const dataDir = path.join(process.cwd(), "data");
  return {
    clock: new SystemClock(),
    cards: new FileCardStore(path.join(dataDir, "cards.json")),
    assetSources: new EmptyAssetSources(),
    prices: new NoPrices(),
    auth: new SessionOwnerAuth(),
    ownerCredentials: new FileOwnerCredentialStore(
      path.join(dataDir, "owner-credential.json"),
    ),
    secrets: new FileSecretStore(path.join(dataDir, "secrets.json")),
  };
}
