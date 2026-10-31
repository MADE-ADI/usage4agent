import { UsageError, usageSnapshot, type UsageSnapshot } from "./usage.js";

export interface UsageState {
  snapshot?: UsageSnapshot;
  error?: string;
  loading: boolean;
}

export function startUsageMonitor({
  load = (signal: AbortSignal) => usageSnapshot(undefined, process.env, signal),
  onChange,
  intervalMs = 60_000,
  minimumGapMs = 5_000,
}: {
  load?: (signal: AbortSignal) => Promise<UsageSnapshot>;
  onChange: (state: UsageState) => void;
  intervalMs?: number;
  minimumGapMs?: number;
}) {
  let stopped = false;
  let state: UsageState = { loading: true };
  let inFlight: Promise<void> | undefined;
  let controller: AbortController | undefined;
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  let lastAttempt = -Infinity;

  const publish = (next: UsageState) => {
    state = next;
    if (!stopped) onChange(next);
  };
  const refresh = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (inFlight) return inFlight;
    if (scheduled !== undefined) clearTimeout(scheduled);
    scheduled = undefined;
    lastAttempt = Date.now();
    controller = new AbortController();
    const signal = controller.signal;
    publish({ ...state, loading: true });
    inFlight = Promise.resolve().then(() => stopped ? undefined : load(signal)).then((snapshot) => {
      if (!stopped && snapshot) publish({ snapshot, loading: false });
    }).catch((error: unknown) => {
      if (stopped) return;
      publish({
        ...state,
        loading: false,
        error: error instanceof UsageError ? error.message : "Gagal memperbarui usage. Periksa koneksi internet.",
      });
    }).finally(() => {
      inFlight = undefined;
      controller = undefined;
    });
    return inFlight;
  };
  const requestRefresh = () => {
    if (stopped || scheduled !== undefined) return;
    // Let a response finish before fetching again; coalesce bursts of session
    // events while still scheduling the final update after the latest activity.
    const delay = Math.max(0, minimumGapMs - (Date.now() - lastAttempt));
    scheduled = setTimeout(() => {
      scheduled = undefined;
      if (inFlight) void inFlight.then(requestRefresh);
      else void refresh();
    }, delay);
    scheduled.unref?.();
  };
  const timer = setInterval(() => { void refresh(); }, intervalMs);
  timer.unref?.();
  void refresh();

  return {
    refresh,
    requestRefresh,
    dispose() {
      stopped = true;
      clearInterval(timer);
      if (scheduled !== undefined) clearTimeout(scheduled);
      controller?.abort();
    },
  };
}

export function monitorText(state: UsageState): string {
  if (state.snapshot) {
    return state.snapshot.summary + (state.error ? "\nData terakhir · Pembaruan gagal, periksa key/koneksi." : "");
  }
  if (state.error) return `Sekai · Usage tidak tersedia\n${state.error}`;
  return "Sekai · Memuat usage…";
}
