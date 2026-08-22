const PING_TIMEOUT_MS = 800;
const ENTITY_TIMEOUT_MS = 2000;
const STATE_TIMEOUT_MS = 3000;
const KAUF_PROJECT_NAME = 'Kauf.RGBWW';
// Real ESPHome ping/state frames are a few hundred bytes each; this caps
// runaway buffering from a non-SSE responder on the LAN that never emits a
// frame boundary.
const SSE_BUFFER_CAP_BYTES = 64 * 1024;

export interface PingResult {
  mac: string;
  hostname: string;
  title: string;
  firmwareVersion: string | null;
  esphomeVersion: string | null;
}

export interface DeviceState {
  on: boolean;
  brightness: number | null;
  r: number | null;
  g: number | null;
  b: number | null;
}

export interface SetStateOptions {
  on?: boolean;
  brightness?: number;
  r?: number;
  g?: number;
  b?: number;
  transition?: number;
}

interface LightStateResponse {
  state: string;
  brightness?: number;
  color?: { r?: number; g?: number; b?: number };
}

async function readSseFrames(
  ip: string,
  timeoutMs: number,
  onFrame: (event: string, data: string) => boolean
): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`http://${ip}/events`, {
      signal: controller.signal,
      headers: { Accept: 'text/event-stream' },
    });

    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        if (buffer.length > SSE_BUFFER_CAP_BYTES) {
          // No frame boundary within the cap - treat like a timeout, not a match.
          await reader.cancel().catch(() => {});
          return;
        }

        let frameEnd;
        while ((frameEnd = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, frameEnd);
          buffer = buffer.slice(frameEnd + 2);

          const eventMatch = frame.match(/event:\s*(\S+)/);
          const dataMatch = frame.match(/data:\s*(.+)/);
          if (eventMatch && dataMatch) {
            const shouldStop = onFrame(eventMatch[1], dataMatch[1]);
            if (shouldStop) {
              await reader.cancel();
              return;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  } catch {
    // Timeout, connection refused, or any network error - caller sees no result.
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function pingBulb(ip: string): Promise<PingResult | null> {
  let result: PingResult | null = null;

  await readSseFrames(ip, PING_TIMEOUT_MS, (event, data) => {
    if (event !== 'ping') return false;
    try {
      const parsed = JSON.parse(data);
      if (parsed.proj_n === KAUF_PROJECT_NAME) {
        result = {
          mac: parsed.mac_addr,
          hostname: parsed.hostname,
          title: parsed.title,
          firmwareVersion: typeof parsed.proj_v === 'string' ? parsed.proj_v : null,
          esphomeVersion: typeof parsed.esph_v === 'string' ? parsed.esph_v : null,
        };
      }
    } catch {
      // Malformed ping frame - not a match.
    }
    return true; // Ping is always the first frame; stop after it either way.
  });

  return result;
}

export async function findLightEntity(ip: string): Promise<string | null> {
  let objectId: string | null = null;

  await readSseFrames(ip, ENTITY_TIMEOUT_MS, (event, data) => {
    if (event !== 'state') return false;
    try {
      const parsed = JSON.parse(data);
      if (parsed.domain === 'light' && parsed.entity_category !== 1 && typeof parsed.id === 'string') {
        objectId = parsed.id.replace(/^light-/, '');
        return true;
      }
    } catch {
      // Malformed state frame - keep reading.
    }
    return false;
  });

  return objectId;
}

export async function getState(ip: string, objectId: string): Promise<DeviceState | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), STATE_TIMEOUT_MS);

  try {
    const response = await fetch(`http://${ip}/light/${objectId}`, { signal: controller.signal });
    if (!response.ok) return null;

    const data = (await response.json()) as LightStateResponse;
    return {
      on: data.state === 'ON',
      brightness: typeof data.brightness === 'number' ? Math.round((data.brightness / 255) * 100) : null,
      r: data.color?.r ?? null,
      g: data.color?.g ?? null,
      b: data.color?.b ?? null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function setState(ip: string, objectId: string, options: SetStateOptions): Promise<boolean> {
  const params = new URLSearchParams();
  const transitionMs = options.transition ?? 1000;
  params.set('transition', (transitionMs / 1000).toString());

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), STATE_TIMEOUT_MS);

  try {
    let url: string;
    if (options.on === false) {
      url = `http://${ip}/light/${objectId}/turn_off?${params.toString()}`;
    } else {
      if (options.brightness !== undefined) {
        params.set('brightness', Math.round((options.brightness / 100) * 255).toString());
      }
      if (options.r !== undefined) params.set('r', options.r.toString());
      if (options.g !== undefined) params.set('g', options.g.toString());
      if (options.b !== undefined) params.set('b', options.b.toString());
      url = `http://${ip}/light/${objectId}/turn_on?${params.toString()}`;
    }

    const response = await fetch(url, { method: 'POST', signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}
