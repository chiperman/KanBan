export {};

// This CLI always constructs production services; APP_ENV=test is not isolation.
// Initialization failures must not expose paths, secrets or provider payloads.
try {
  const { createProductionServices } = await import("../src/server/production");
  const services = createProductionServices();
  const result = await services.formalDailySettlementRunner.run();
  process.stdout.write(JSON.stringify(result) + "\n");
  if (result.outcome === "error") process.exitCode = 1;
} catch {
  process.stderr.write(JSON.stringify({ outcome: "error", reason: "initialization-failed" }) + "\n");
  process.exitCode = 1;
}
