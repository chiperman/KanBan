export {};
try {
  const { createProductionServices } = await import("../src/server/production");
  await createProductionServices().backgroundCollection.run();
} catch {
  process.stderr.write("后台采集失败，请检查设置中的来源状态。\n");
  process.exitCode = 1;
}
