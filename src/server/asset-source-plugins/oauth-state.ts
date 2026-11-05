interface StartedAuthorization {
  connectionMode?: import("@/server/asset-sources/longbridge-connection").LongbridgeConnectionMode;
  codeVerifier: string;
  redirectUri: string;
  reauthorization?: {
    sourceId: string;
    expectedAccountId: string;
  };
  expiresAt: number;
}

/** OAuth PKCE 临时态只在服务端内存中存活。 */
export class LongbridgeOAuthState {
  private readonly starts = new Map<string, StartedAuthorization>();
  private readonly startTimers = new Map<string, NodeJS.Timeout>();

  private clearStart(state: string): void {
    this.starts.delete(state);
    const timer = this.startTimers.get(state);
    if (timer) clearTimeout(timer);
    this.startTimers.delete(state);
  }

  rememberStart(
    state: string,
    value: Omit<StartedAuthorization, "expiresAt">,
  ): void {
    this.clearStart(state);
    const expiresAt = Date.now() + 10 * 60_000;
    this.starts.set(state, { ...value, expiresAt });
    const timer = setTimeout(() => this.clearStart(state), expiresAt - Date.now());
    timer.unref();
    this.startTimers.set(state, timer);
  }

  consumeStart(state: string): StartedAuthorization | null {
    const value = this.starts.get(state) ?? null;
    this.clearStart(state);
    return value && value.expiresAt >= Date.now() ? value : null;
  }

}
