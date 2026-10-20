export interface OwnerSession {
  ownerId: string;
  authenticatedAt: Date;
  lastActivityAt: Date;
}

/** 所有者身份认证；未验证身份时返回 null（锁定状态）。 */
export interface OwnerAuth {
  currentSession(): Promise<OwnerSession | null>;
}

/** 唯一所有者的 Passkey 凭证（公钥，非秘密）；已登录时可替换或移除。 */
export interface OwnerCredential {
  id: string;
  publicKey: string;
  counter: number;
  transports?: string[];
  /** 绑定时间（ISO 8601）；旧文件可能缺失。 */
  createdAt?: string;
}

/** 所有者 Passkey 凭证存储；始终至多保存一个凭证，注册入口仅对首次预置或已登录所有者开放。 */
export interface OwnerCredentialStore {
  get(): Promise<OwnerCredential | null>;
  save(credential: OwnerCredential): Promise<void>;
  remove(): Promise<void>;
}

export interface OwnerRecoveryCredential {
  version: 2;
  encryptedTotpSecret: string;
  totpIv: string;
  totpAuthTag: string;
  lastUsedTotpCounter: string | null;
}

/** 备用登录元数据；TOTP 密钥仅以服务端密钥加密后持久化。 */
export interface OwnerRecoveryCredentialStore {
  get(): Promise<OwnerRecoveryCredential | null>;
  save(credential: OwnerRecoveryCredential): Promise<void>;
  claimTotpCounter(counter: string): Promise<boolean>;
}
