const DEFAULT_STREAMS = 'news,predictions,perps';
const DEFAULT_THEME = 'dark';
const DEFAULT_SPEED = 0.7;
const DEFAULT_HEIGHT = 48;

/** Speed param: 0.1 = slowest, 1 = medium, 3 = fastest. Clamped to [0.1, 3]. */
const SPEED_MIN = 0.1;
const SPEED_MAX = 3;

export interface TickerParams {
  streams: string;
  theme: string;
  speed: number;
  height: number;
}

type RawParam = string | string[] | undefined;

function first(value: RawParam): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function clampNumber(
  raw: string | undefined,
  min: number,
  max: number,
  fallback: number
): number {
  // Number() rejects partial numerics like "40px" (parseInt would accept).
  const value = raw == null || raw.trim() === '' ? Number.NaN : Number(raw);
  return Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

/**
 * Parse ticker embed query params. Runs on the server so SSR and the first
 * client render agree (reading window.location during render caused
 * hydration mismatches).
 */
export function parseTickerParams(
  searchParams: Record<string, RawParam>
): TickerParams {
  return {
    streams: first(searchParams.streams)?.trim() || DEFAULT_STREAMS,
    theme: (first(searchParams.theme) || DEFAULT_THEME).toLowerCase(),
    speed: clampNumber(
      first(searchParams.speed),
      SPEED_MIN,
      SPEED_MAX,
      DEFAULT_SPEED
    ),
    height: Math.round(
      clampNumber(first(searchParams.height), 32, 120, DEFAULT_HEIGHT)
    ),
  };
}
