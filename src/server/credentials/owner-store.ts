import { rm } from "node:fs/promises";

import { atomicWritePrivateFile, readPrivateFile } from "@/server/local-data-permissions";
import { isMissingFile } from "@/server/persistence/file-errors";
import type { OwnerCredential, OwnerCredentialStore, OwnerRecoveryCredential, OwnerRecoveryCredentialStore } from "@/server/ports";

function isOwnerCredential(value: unknown): value is OwnerCredential {
  if (typeof value !== "object" || value === null) return false;
  const credential = value as Record<string, unknown>;
  return (
    typeof credential.id === "string" &&
    typeof credential.publicKey === "string" &&
    typeof credential.counter === "number"
  );
}

export class FileOwnerCredentialStore implements OwnerCredentialStore {
  constructor(private readonly filePath: string) {}

  async get(): Promise<OwnerCredential | null> {
    let raw: string;
    try {
      raw = await readPrivateFile(this.filePath);
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
    const value: unknown = JSON.parse(raw);
    if (!isOwnerCredential(value)) {
      throw new Error(`所有者凭证文件格式无效: ${this.filePath}`);
    }
    return value;
  }

  async save(credential: OwnerCredential): Promise<void> {
    await atomicWritePrivateFile(
      this.filePath,
      JSON.stringify(credential, null, 2),
    );
  }
}

function isOwnerRecoveryCredential(
  value: unknown,
): value is OwnerRecoveryCredential {
  if (typeof value !== "object" || value === null) return false;
  const credential = value as Record<string, unknown>;
  return (
    credential.version === 2 &&
    typeof credential.encryptedTotpSecret === "string" &&
    typeof credential.totpIv === "string" &&
    typeof credential.totpAuthTag === "string" &&
    (credential.lastUsedTotpCounter === null ||
      (typeof credential.lastUsedTotpCounter === "string" &&
        /^\d+$/u.test(credential.lastUsedTotpCounter)))
  );
}

function isLegacyOwnerRecoveryCredential(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const credential = value as Record<string, unknown>;
  return (
    typeof credential.email === "string" &&
    typeof credential.passwordSalt === "string" &&
    typeof credential.passwordHash === "string" &&
    typeof credential.encryptedTotpSecret === "string" &&
    typeof credential.totpIv === "string" &&
    typeof credential.totpAuthTag === "string"
  );
}

export class FileOwnerRecoveryCredentialStore
  implements OwnerRecoveryCredentialStore
{
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  get(): Promise<OwnerRecoveryCredential | null> {
    return this.serialize(() => this.read());
  }

  private async read(): Promise<OwnerRecoveryCredential | null> {
    let raw: string;
    try {
      raw = await readPrivateFile(this.filePath);
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
    const value: unknown = JSON.parse(raw);
    if (isLegacyOwnerRecoveryCredential(value)) {
      await rm(this.filePath, { force: true });
      return null;
    }
    if (!isOwnerRecoveryCredential(value)) {
      throw new Error(`恢复认证文件格式无效: ${this.filePath}`);
    }
    return value;
  }

  save(credential: OwnerRecoveryCredential): Promise<void> {
    return this.serialize(() => atomicWritePrivateFile(
      this.filePath,
      JSON.stringify(credential, null, 2),
    ));
  }

  claimTotpCounter(counter: string): Promise<boolean> {
    return this.serialize(async () => {
      const credential = await this.read();
      if (!credential) return false;
      const previous = credential.lastUsedTotpCounter;
      if (previous !== null && BigInt(counter) <= BigInt(previous)) return false;
      await atomicWritePrivateFile(
        this.filePath,
        JSON.stringify({ ...credential, lastUsedTotpCounter: counter }, null, 2),
      );
      return true;
    });
  }
}
