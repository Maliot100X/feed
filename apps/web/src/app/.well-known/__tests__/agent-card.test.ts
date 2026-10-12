import { describe, expect, it } from 'bun:test';
import { GET as getAlias } from '../agent-card/route';
import { GET as getCanonical } from '../agent-card.json/route';

describe('/.well-known/agent-card alias', () => {
  it('serves the same card and headers as agent-card.json', async () => {
    const alias = await getAlias();
    const canonical = await getCanonical();

    expect(alias.status).toBe(200);
    expect(alias.headers.get('access-control-allow-origin')).toBe('*');
    expect(alias.headers.get('cache-control')).toBe(
      canonical.headers.get('cache-control')
    );
    expect(await alias.json()).toEqual(await canonical.json());
  });
});
