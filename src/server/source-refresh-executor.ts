import {
  abortableSyncDelay,
  abortableSyncOperation,
  AssetRequestError,
  assetSyncErrorMessage,
  diagnoseAssetSyncError,
  withManagedAssetRetry,
  ASSET_SYNC_ATTEMPT_LIMIT,
} from "@/server/asset-sync-diagnostics";
import type {
  AssetRefreshMode,
  AssetSourceRefresher,
  AssetSourceRefreshResult,
  AssetSyncAttempt,
  AssetSyncDiagnostic,
  AssetSourceSummary,
  AssetSources,
  Clock,
  SecretStore,
} from "@/server/ports";
import { isMacOSKeychainCredentialReference } from "@/server/asset-sources/longbridge-keychain-sdk";

export type SourceRefreshOutcome = "success" | "failure" | "superseded";

/** 执行单来源刷新，集中处理凭证、重试、超时与同步诊断。 */
export class SourceRefreshExecutor {
  constructor(
    private readonly sources: AssetSources,
    private readonly secrets: SecretStore,
    private readonly clock: Clock,
    private readonly refresher: AssetSourceRefresher,
    private readonly sourceTimeoutMs: number,
  ) {}

  async execute(
    source: AssetSourceSummary,
    mode: AssetRefreshMode,
    attemptedAt: string,
  ): Promise<SourceRefreshOutcome> {
    const controller = new AbortController();
    const startedAt = performance.now();
    const timeout = setTimeout(() => {
      controller.abort(new DOMException("Source refresh budget exhausted", "TimeoutError"));
    }, this.sourceTimeoutMs);
    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const attemptController = new AbortController();
        const signal = AbortSignal.any([controller.signal, attemptController.signal]);
        const attemptStartedAt = performance.now();
        const attemptAt = this.clock.now().toISOString();
        let stage: AssetSyncDiagnostic["stage"] = "credentials";
        let result: AssetSourceRefreshResult | undefined;
        let failure: unknown;
        try {
          result = await abortableSyncOperation(signal, async () => {
            signal.throwIfAborted();
            const credentialReference = source.credentialReference;
            if (credentialReference === null) throw new Error("只读凭证不可用");
            const usesKeychainReference = source.kind === "longbridge" &&
              isMacOSKeychainCredentialReference(credentialReference);
            const credentials = usesKeychainReference
              ? credentialReference
              : await this.secrets.get(credentialReference);
            signal.throwIfAborted();
            if (credentials === null) throw new Error("只读凭证不可用");
            stage = "refresh";
            return withManagedAssetRetry(() => this.refresher.refresh({
              source, credentials, mode, attemptedAt, signal,
              persistCredentials: async (value) => {
                signal.throwIfAborted();
                if (usesKeychainReference) return;
                if (await this.currentVersion(source) === null) {
                  throw new DOMException("Source was replaced", "AbortError");
                }
                signal.throwIfAborted();
                try { await this.secrets.replace(credentialReference, value); }
                catch (error) { stage = "persist"; throw error; }
              },
            }));
          });
        } catch (error) {
          failure = error;
        } finally {
          attemptController.abort();
        }
        const durationMs = Math.max(0, Math.round(performance.now() - attemptStartedAt));
        const current = await this.currentVersion(source);
        if (current === null) return "superseded";
        const diagnostic = result === undefined
          ? diagnoseAssetSyncError(failure, stage, durationMs) : null;
        const record: AssetSyncAttempt = {
          attemptedAt: attemptAt, mode, attempt,
          outcome: result === undefined ? "failure" : "success",
          durationMs, diagnostic,
        };
        const recentAttempts = [...(current.sync.recentAttempts ?? []), record].slice(-ASSET_SYNC_ATTEMPT_LIMIT);
        if (result !== undefined) {
          await this.sources.update({
            ...current, snapshot: result.snapshot,
            sync: {
              status: "current", lastSuccessfulAt: result.snapshot.syncedAt,
              lastAttemptAt: attemptedAt, error: null, failedMode: null,
              diagnostic: null, recentAttempts,
            },
          });
          return "success";
        }
        await this.sources.update({
          ...current,
          sync: {
            ...current.sync, status: "expired", lastAttemptAt: attemptedAt,
            error: assetSyncErrorMessage(diagnostic!), failedMode: mode,
            diagnostic, recentAttempts,
          },
        });
        if (!diagnostic!.retryable || attempt === 3 || controller.signal.aborted) return "failure";
        const delay = Math.max(500 * 2 ** (attempt - 1),
          failure instanceof AssetRequestError ? failure.retryAfterMs ?? 0 : 0);
        const remaining = this.sourceTimeoutMs - (performance.now() - startedAt);
        if (delay >= remaining) return "failure";
        try { await abortableSyncDelay(delay, controller.signal); }
        catch { return "failure"; }
        if (await this.currentVersion(source) === null) return "superseded";
      }
      return "failure";
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  }

  private async currentVersion(source: AssetSourceSummary): Promise<AssetSourceSummary | null> {
    const current = (await this.sources.list()).find((candidate) => candidate.id === source.id);
    if (
      current === undefined ||
      current.kind === "manual" ||
      current.lifecycle === "disconnected" ||
      current.credentialReference === null ||
      current.credentialReference !== source.credentialReference
    ) return null;
    return current;
  }
}
