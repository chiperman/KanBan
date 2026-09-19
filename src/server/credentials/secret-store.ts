import { createCipheriv, createDecipheriv, randomBytes, randomUUID, } from "node:crypto";

import { atomicWritePrivateFile, readPrivateFile } from "@/server/local-data-permissions";
import { isMissingFile } from "@/server/persistence/file-errors";
import type { SecretStore } from "@/server/ports";

/** 独立加密凭证文件；普通 Dashboard 数据与同步快照无法读取其内容。 */
interface StoredSecret {
  sealed: string;
  state: "pending" | "committed";
}

export interface TransactionalSecretStore extends SecretStore {
  stage(value: string): Promise<string>;
  commit(reference: string): Promise<void>;
}

export class FileEncryptedSecretStore implements SecretStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private key(): Buffer {
    const encoded = process.env.PAD_SECRET_ENCRYPTION_KEY;
    const key = encoded ? Buffer.from(encoded, "base64") : Buffer.alloc(0);
    if (key.length !== 32) {
      throw new Error(
        "PAD_SECRET_ENCRYPTION_KEY 必须配置为 32 字节 Base64 服务端密钥",
      );
    }
    return key;
  }

  private seal(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return JSON.stringify({
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      value: encrypted.toString("base64"),
    });
  }

  private unseal(sealed: string): string {
    const parsed = JSON.parse(sealed) as { iv: string; tag: string; value: string };
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key(),
      Buffer.from(parsed.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(parsed.value, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }

  private async load(): Promise<Record<string, StoredSecret>> {
    try {
      const value: unknown = JSON.parse(await readPrivateFile(this.filePath));
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`凭证存储格式无效: ${this.filePath}`);
      }
      return value as Record<string, StoredSecret>;
    } catch (error) {
      if (isMissingFile(error)) return {};
      throw error;
    }
  }

  private async write(values: Record<string, StoredSecret>): Promise<void> {
    await atomicWritePrivateFile(this.filePath, JSON.stringify(values));
  }

  private mutate<T>(operation: (values: Record<string, StoredSecret>) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const values = await this.load();
      const result = operation(values);
      await this.write(values);
      return result;
    });
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  stage(value: string): Promise<string> {
    return this.mutate((values) => {
      const reference = randomUUID();
      values[reference] = { sealed: this.seal(value), state: "pending" };
      return reference;
    });
  }

  commit(reference: string): Promise<void> {
    return this.mutate((values) => {
      const value = values[reference];
      if (!value) throw new Error("待提交凭证不存在");
      value.state = "committed";
    });
  }

  async put(value: string): Promise<string> {
    const reference = await this.stage(value);
    await this.commit(reference);
    return reference;
  }

  async get(reference: string): Promise<string | null> {
    await this.queue;
    const value = (await this.load())[reference];
    return value?.state === "committed" ? this.unseal(value.sealed) : null;
  }

  replace(reference: string, value: string): Promise<void> {
    return this.mutate((values) => {
      const current = values[reference];
      if (!current || current.state !== "committed") {
        throw new Error("凭证引用不存在或尚未提交");
      }
      current.sealed = this.seal(value);
    });
  }

  remove(reference: string): Promise<void> {
    return this.mutate((values) => {
      delete values[reference];
    });
  }

  recover(validReferences: Set<string>): Promise<void> {
    return this.mutate((values) => {
      for (const [reference, value] of Object.entries(values)) {
        if (value.state !== "pending") continue;
        if (validReferences.has(reference)) value.state = "committed";
        else delete values[reference];
      }
    });
  }
}

export class ReadySecretStore implements SecretStore {
  constructor(
    private readonly secrets: FileEncryptedSecretStore,
    private readonly ready: Promise<void>,
  ) {}
  async put(value: string) {
    await this.ready;
    return this.secrets.put(value);
  }
  async get(reference: string) {
    await this.ready;
    return this.secrets.get(reference);
  }
  async replace(reference: string, value: string) {
    await this.ready;
    return this.secrets.replace(reference, value);
  }
  async remove(reference: string) {
    await this.ready;
    return this.secrets.remove(reference);
  }
}
