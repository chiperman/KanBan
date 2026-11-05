export type AbortableSleep = (
  milliseconds: number,
  signal?: AbortSignal,
) => Promise<void>;

/**
 * 各交易所限频等待的公共实现。
 * 已取消时先拒绝；等待结束或取消时清理监听，避免定时器泄漏。
 */
export function createAbortableSleep(cancelledMessage: string): AbortableSleep {
  return (milliseconds, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error(cancelledMessage));
      return;
    }
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new Error(cancelledMessage));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
