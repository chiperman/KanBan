import type { Clock, FormalDailySettlementRunner, FormalSettlementExecutions, FormalSettlementRunResult } from "@/server/ports";

/** Scheduled executions cross this boundary; no provider exception escapes it. */
export class ObservedFormalSettlementRunner implements FormalDailySettlementRunner {
  constructor(
    private readonly runner: FormalDailySettlementRunner,
    private readonly executions: FormalSettlementExecutions,
    private readonly clock: Clock,
  ) {}

  async run(): Promise<FormalSettlementRunResult> {
    const startedAt = this.clock.now().toISOString();
    let result: FormalSettlementRunResult;
    try {
      result = await this.runner.run();
    } catch {
      result = { outcome: "error", reason: "execution-failed" };
    }
    try {
      await this.executions.record({
        startedAt, finishedAt: this.clock.now().toISOString(),
        outcome: result.outcome, reason: result.reason ?? null,
        settlementStatus: result.settlementStatus ?? null,
      });
    } catch {
      // SQLite may itself be unavailable; do not claim the record was saved.
      return { outcome: "error", reason: "execution-record-failed" };
    }
    return result;
  }
}
