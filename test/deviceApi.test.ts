import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pingBulb, findLightEntity, getState, setState } from '../src/bulbs/deviceApi';

function sseResponse(text: string, status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return new Response(stream, { status });
}

const PING_FRAME =
  'event: ping\ndata: {"title":"Kauf Bulb 7d49e0","esph_v":"2026.3.0","proj_n":"Kauf.RGBWW","proj_v":"2.00(u)","mac_addr":"C4:5B:BE:7D:49:E0","hostname":"kauf-bulb-7d49e0"}\n\n';

const NON_KAUF_PING_FRAME =
  'event: ping\ndata: {"title":"Some Other Device","proj_n":"SomethingElse"}\n\n';

const STATE_FRAMES =
  'event: state\ndata: {"name_id":"binary_sensor/4MiB","id":"binary_sensor-4mib","domain":"binary_sensor","entity_category":2}\n\n' +
  'event: state\ndata: {"name_id":"light/Warm RGB","id":"light-warm_rgb","domain":"light","entity_category":1}\n\n' +
  'event: state\ndata: {"name_id":"light/Cold RGB","id":"light-cold_rgb","domain":"light","entity_category":1}\n\n' +
  'event: state\ndata: {"name_id":"light/Kauf Bulb 7d49e0","id":"light-kauf_bulb_7d49e0","domain":"light","state":"ON","brightness":140,"color":{"r":39,"g":183,"b":255}}\n\n';

describe('pingBulb', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('returns device identity for a genuine Kauf bulb', async () => {
    (global.fetch as any).mockResolvedValue(sseResponse(PING_FRAME));

    const result = await pingBulb('192.168.1.26');

    expect(result).toEqual({
      mac: 'C4:5B:BE:7D:49:E0',
      hostname: 'kauf-bulb-7d49e0',
      title: 'Kauf Bulb 7d49e0',
    });
  });

  it('returns null when proj_n does not match the Kauf signature', async () => {
    (global.fetch as any).mockResolvedValue(sseResponse(NON_KAUF_PING_FRAME));

    expect(await pingBulb('192.168.1.50')).toBeNull();
  });

  it('returns null when the connection fails', async () => {
    (global.fetch as any).mockRejectedValue(new Error('connection refused'));

    expect(await pingBulb('192.168.1.99')).toBeNull();
  });

  it('returns null on a non-ok response', async () => {
    (global.fetch as any).mockResolvedValue(sseResponse('', 404));

    expect(await pingBulb('192.168.1.99')).toBeNull();
  });

  it('cancels the response body on a non-ok response instead of leaking it', async () => {
    const response = sseResponse('', 404);
    const cancelSpy = vi.spyOn(response.body!, 'cancel');
    (global.fetch as any).mockResolvedValue(response);

    await pingBulb('192.168.1.99');

    expect(cancelSpy).toHaveBeenCalled();
  });

  it('stops reading and does not hang when a device streams past the buffer cap without a frame boundary', async () => {
    // Simulate a non-SSE responder: 200 OK but a huge blob of data with no
    // "\n\n" frame boundary anywhere in it.
    const encoder = new TextEncoder();
    const hugeChunk = encoder.encode('x'.repeat(70 * 1024));
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(hugeChunk);
        // Deliberately never closes, mirroring a real never-ending stream -
        // the cap must trigger a return before this would hang.
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = new Response(stream, { status: 200 });
    (global.fetch as any).mockResolvedValue(response);

    const result = await pingBulb('192.168.1.99');

    expect(result).toBeNull();
    expect(cancelled).toBe(true);
  });
});

describe('findLightEntity', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('finds the primary light entity and skips hidden config lights', async () => {
    (global.fetch as any).mockResolvedValue(sseResponse(PING_FRAME + STATE_FRAMES));

    expect(await findLightEntity('192.168.1.26')).toBe('kauf_bulb_7d49e0');
  });

  it('returns null when no matching light entity appears', async () => {
    (global.fetch as any).mockResolvedValue(sseResponse(PING_FRAME));

    expect(await findLightEntity('192.168.1.26')).toBeNull();
  });
});

describe('getState', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('converts device state to our API shape', async () => {
    (global.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ state: 'ON', brightness: 140, color: { r: 39, g: 183, b: 255 } }), {
        status: 200,
      })
    );

    expect(await getState('192.168.1.26', 'kauf_bulb_7d49e0')).toEqual({
      on: true,
      brightness: 55,
      r: 39,
      g: 183,
      b: 255,
    });
  });

  it('returns null when the bulb does not respond', async () => {
    (global.fetch as any).mockRejectedValue(new Error('timeout'));

    expect(await getState('192.168.1.26', 'kauf_bulb_7d49e0')).toBeNull();
  });
});

describe('setState', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  });

  it('calls turn_off when on is false', async () => {
    const success = await setState('192.168.1.26', 'kauf_bulb_7d49e0', { on: false });

    expect(success).toBe(true);
    const calledUrl = (global.fetch as any).mock.calls[0][0] as string;
    expect(calledUrl).toContain('/light/kauf_bulb_7d49e0/turn_off');
    expect(calledUrl).toContain('transition=1');
  });

  it('calls turn_on with only the provided attributes', async () => {
    await setState('192.168.1.26', 'kauf_bulb_7d49e0', { brightness: 50 });

    const calledUrl = (global.fetch as any).mock.calls[0][0] as string;
    expect(calledUrl).toContain('/light/kauf_bulb_7d49e0/turn_on');
    expect(calledUrl).toContain('brightness=128');
    expect(calledUrl).not.toContain('r=');
  });

  it('defaults transition to 1000ms (1 second) when omitted', async () => {
    await setState('192.168.1.26', 'kauf_bulb_7d49e0', { on: true });

    const calledUrl = (global.fetch as any).mock.calls[0][0] as string;
    expect(calledUrl).toContain('transition=1');
  });

  it('returns false when the device call fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('timeout'));

    expect(await setState('192.168.1.26', 'kauf_bulb_7d49e0', { on: true })).toBe(false);
  });
});
