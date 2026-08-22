// src/bulbs/validation.ts
import { SetStateOptions } from './deviceApi';

export function parseSetOptions(body: Record<string, unknown>): { valid: boolean; options?: SetStateOptions } {
  const options: SetStateOptions = {};

  if (body.on !== undefined) {
    if (typeof body.on !== 'boolean') return { valid: false };
    options.on = body.on;
  }

  if (body.brightness !== undefined) {
    if (typeof body.brightness !== 'number' || body.brightness < 0 || body.brightness > 100) {
      return { valid: false };
    }
    options.brightness = body.brightness;
  }

  for (const key of ['r', 'g', 'b'] as const) {
    const value = body[key];
    if (value !== undefined) {
      if (typeof value !== 'number' || value < 0 || value > 255) return { valid: false };
      options[key] = value;
    }
  }

  if (body.transition !== undefined) {
    if (typeof body.transition !== 'number' || body.transition < 0) return { valid: false };
    options.transition = body.transition;
  }

  return { valid: true, options };
}
