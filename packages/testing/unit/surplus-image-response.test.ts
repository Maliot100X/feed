import { expect, test } from 'bun:test';
import { parseSurplusImageSource } from '../../engine/src/services/surplus-image-service';

test('accepts the inline raster format returned by Surplus sellers', async () => {
  const source = 'data:image/png;base64,iVBORw0KGgo=';
  expect(parseSurplusImageSource({ data: [{ url: source }] })).toBe(source);
  const image = await fetch(source);
  expect(image.headers.get('content-type')).toBe('image/png');
  expect((await image.arrayBuffer()).byteLength).toBe(8);
});

test('accepts HTTPS images and rejects active or insecure sources', () => {
  const source = 'https://images.example.com/generated.png';
  expect(parseSurplusImageSource({ data: [{ url: source }] })).toBe(source);
  for (const url of [
    'http://example.com/a.png',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'javascript:alert(1)',
  ]) {
    expect(() => parseSurplusImageSource({ data: [{ url }] })).toThrow();
  }
});
