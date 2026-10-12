/** Approved Peep identity. Eye cutouts are transparent on every background. */
export const FEED_MARK_PATH =
  'M27 17H73Q90 17 90 34V64Q90 80 73 80H43L23 93V79Q10 76 10 63V34Q10 17 27 17Z M32 42A5 5 0 0 1 42 42V55A5 5 0 0 1 32 55Z M58 42A5 5 0 0 1 68 42V55A5 5 0 0 1 58 55Z';

/** Custom path lettering; no font dependency. */
export const FEED_WORDMARK_PATHS = [
  { x: 0, d: 'M43 13C26 8 22 19 22 33V80M8 36H43' },
  { x: 53, d: 'M12 52H48C48 20 10 20 10 52C10 80 36 87 49 70' },
  { x: 112, d: 'M12 52H48C48 20 10 20 10 52C10 80 36 87 49 70' },
  { x: 171, d: 'M48 12V80M48 52C48 20 10 20 10 52C10 85 48 85 48 52' },
] as const;
export const FEED_DOMAIN_PATHS = [
  { x: 256, d: 'M43 13C26 8 22 19 22 33V80M8 36H43' },
  { x: 309, d: 'M10 34V60C10 89 47 89 47 60V34' },
  { x: 368, d: 'M10 80V34M10 54C10 26 47 26 47 54V80' },
] as const;
