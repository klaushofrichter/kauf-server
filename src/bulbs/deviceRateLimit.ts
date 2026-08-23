const WINDOW_MS = 1000;
const MAX_CALLS_PER_WINDOW = 3;

const callTimestamps = new Map<string, number[]>();

export function allowDeviceCall(ip: string): boolean {
  const now = Date.now();
  const recent = (callTimestamps.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);

  if (recent.length >= MAX_CALLS_PER_WINDOW) {
    callTimestamps.set(ip, recent);
    return false;
  }

  recent.push(now);
  callTimestamps.set(ip, recent);
  return true;
}

export function resetDeviceRateLimit(): void {
  callTimestamps.clear();
}
