import type {
  OwnerCredential,
  OwnerCredentialStore,
  OwnerRecoveryCredential,
  OwnerRecoveryCredentialStore,
  SecretStore,
} from "@/server/ports";

export class InMemoryOwnerCredentialStore implements OwnerCredentialStore {
  private credential: OwnerCredential | null = null;

  async get(): Promise<OwnerCredential | null> {
    return this.credential;
  }

  async save(credential: OwnerCredential): Promise<void> {
    this.credential = credential;
  }
}

export class InMemoryOwnerRecoveryCredentialStore
  implements OwnerRecoveryCredentialStore
{
  private credential: OwnerRecoveryCredential | null = null;

  async get(): Promise<OwnerRecoveryCredential | null> {
    return this.credential;
  }

  async save(credential: OwnerRecoveryCredential): Promise<void> {
    this.credential = credential;
  }

  async claimTotpCounter(counter: string): Promise<boolean> {
    if (!this.credential) return false;
    const previous = this.credential.lastUsedTotpCounter;
    if (previous !== null && BigInt(counter) <= BigInt(previous)) return false;
    this.credential = { ...this.credential, lastUsedTotpCounter: counter };
    return true;
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

  async replace(reference: string, value: string): Promise<void> {
    if (!this.values.has(reference)) throw new Error("凭证引用不存在");
    this.values.set(reference, value);
  }

  async remove(reference: string): Promise<void> {
    this.values.delete(reference);
  }

  size(): number {
    return this.values.size;
  }
}