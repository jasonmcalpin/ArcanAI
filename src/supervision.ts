import type { PluginStreamEvent } from "./types.js";

/** Timer policy is per request. Omitted deadlines mean no forced timeout. */
export interface ExecutionTimers {
  heartbeatMs?: number;
  idleMs?: number;
  totalMs?: number;
}

export class ExecutionTimeoutError extends Error {
  constructor(public readonly reason: "IDLE_TIMEOUT" | "EXECUTION_TIMEOUT") {
    super(reason === "IDLE_TIMEOUT" ? "provider was inactive beyond idle deadline" : "execution exceeded total deadline");
    this.name = "ExecutionTimeoutError";
  }
}

export function validateTimers(value: ExecutionTimers | undefined): ExecutionTimers {
  if (value === undefined) return { heartbeatMs: 5000 };
  const allowed = ["heartbeatMs", "idleMs", "totalMs"];
  for (const [key, ms] of Object.entries(value)) {
    if (!allowed.includes(key) || typeof ms !== "number" || !Number.isSafeInteger(ms) || ms < 1) {
      throw new TypeError(`timeouts.${key} must be a positive integer in milliseconds`);
    }
  }
  return { heartbeatMs: 5000, ...value };
}

type Pending =
  | { kind: "provider"; result: IteratorResult<PluginStreamEvent> }
  | { kind: "rejected"; error: unknown };
type Observation =
  | { kind: "provider"; value: PluginStreamEvent }
  | { kind: "heartbeat"; elapsedMs: number; idleMs: number };

function providerNext(iterator: AsyncIterator<PluginStreamEvent>): Promise<Pending> {
  return Promise.resolve()
    .then(() => iterator.next())
    .then(result => ({ kind: "provider", result }) as const, error => ({ kind: "rejected", error }) as const);
}

/**
 * Observe one provider iterator without issuing overlapping next() calls.
 * A supervisor heartbeat is not proof of model progress or connection health.
 */
export async function* supervise(
  source: AsyncIterable<PluginStreamEvent>,
  signal: AbortSignal,
  timers?: ExecutionTimers
): AsyncIterable<Observation> {
  const config = validateTimers(timers);
  const iterator = source[Symbol.asyncIterator]();
  const start = performance.now();
  let lastActivity = start;
  let nextHeartbeat = config.heartbeatMs === undefined ? Infinity : start + config.heartbeatMs;
  let pending = providerNext(iterator);
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<{ kind: "abort" }>(resolve => {
    onAbort = () => resolve({ kind: "abort" });
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  let naturallyFinished = false;
  try {
    while (true) {
      if (signal.aborted) return;
      const now = performance.now();
      if (config.totalMs !== undefined && now - start >= config.totalMs) {
        throw new ExecutionTimeoutError("EXECUTION_TIMEOUT");
      }
      if (config.idleMs !== undefined && now - lastActivity >= config.idleMs) {
        throw new ExecutionTimeoutError("IDLE_TIMEOUT");
      }
      const nextDue = Math.min(
        nextHeartbeat,
        config.totalMs === undefined ? Infinity : start + config.totalMs,
        config.idleMs === undefined ? Infinity : lastActivity + config.idleMs
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timerPromise = new Promise<{ kind: "tick" }>(resolve => {
        if (Number.isFinite(nextDue)) timer = setTimeout(() => resolve({ kind: "tick" }), Math.max(0, nextDue - now));
      });
      const event = await Promise.race([pending, aborted, timerPromise]);
      if (timer !== undefined) clearTimeout(timer);

      if (event.kind === "abort") return;
      if (event.kind === "tick") {
        // On the next loop, total/idle deadlines are checked before heartbeat.
        const current = performance.now();
        if (config.heartbeatMs !== undefined && current >= nextHeartbeat) {
          nextHeartbeat = current + config.heartbeatMs;
          yield { kind: "heartbeat", elapsedMs: Math.round(current - start), idleMs: Math.round(current - lastActivity) };
        }
        continue;
      }
      if (event.kind === "rejected") throw event.error;
      if (event.result.done) {
        naturallyFinished = true;
        return;
      }
      lastActivity = performance.now();
      pending = providerNext(iterator);
      yield { kind: "provider", value: event.result.value };
    }
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
    if (!naturallyFinished) {
      // Do not block failure handling waiting on a hung iterator's return().
      try { void iterator.return?.().catch(() => {}); } catch { /* best-effort cleanup */ }
    }
  }
}
