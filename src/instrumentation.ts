export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.APP_ENV === "test") {
    const { initializeTestServices } = await import("./server/testing/composition");
    initializeTestServices();
  }
}
