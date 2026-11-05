import { SESSION_IDLE_TIMEOUT_MS } from "@/shared/session-policy";

export const ACTIVITY_COALESCE_MS = 60_000;
/** Local activity is immediate; only successful server acknowledgements extend trust. */
export function trackSessionActivity(input: {
  notify(signal: AbortSignal): Promise<{ status: number; ok: boolean }>;
  lock(): void;
  visible(): boolean;
}) {
  let stopped = false;
  let lastActivity = Date.now();
  let confirmedAt = lastActivity;
  let lastSent = -Infinity;
  let dirty = true;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout>;
  const controller = new AbortController();

  function stop() {
    stopped = true;
    clearTimeout(timer);
    controller.abort();
  }
  function lock() { stop(); input.lock(); }
  function schedule() {
    clearTimeout(timer);
    if (stopped) return;
    const deadline = Math.min(lastActivity, confirmedAt) + SESSION_IDLE_TIMEOUT_MS;
    if (Date.now() >= deadline) { lock(); return; }
    const nextSend = dirty && !inFlight && input.visible() ? Math.max(Date.now(), lastSent + ACTIVITY_COALESCE_MS) : Infinity;
    timer = setTimeout(tick, Math.max(0, Math.min(deadline, nextSend) - Date.now()));
  }
  function tick() {
    if (stopped) return;
    if (Date.now() >= Math.min(lastActivity, confirmedAt) + SESSION_IDLE_TIMEOUT_MS) { lock(); return; }
    if (dirty && !inFlight && input.visible() && Date.now() >= lastSent + ACTIVITY_COALESCE_MS) {
      dirty = false;
      inFlight = true;
      const sentAt = lastSent = Date.now();
      void input.notify(controller.signal).then(response => {
        if (stopped) return;
        if (response.status === 401) { lock(); return; }
        if (response.ok) confirmedAt = sentAt;
        else dirty = true;
      }).catch(() => { if (!stopped) dirty = true; }).finally(() => {
        inFlight = false;
        schedule();
      });
    }
    schedule();
  }
  function activity() {
    if (stopped || !input.visible()) return;
    lastActivity = Date.now();
    dirty = true;
    tick();
  }
  tick();
  return { activity, visibilityChanged: tick, dispose: stop };
}
