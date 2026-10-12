import { describe, expect, it } from 'bun:test';
import { getExplorer, getExplorerTxUrl } from './explorer';

describe('block explorer', () => {
  it('builds tx URLs for supported chains', () => {
    expect(getExplorerTxUrl('0xabc', 8453)).toBe(
      'https://basescan.org/tx/0xabc'
    );
    expect(getExplorer(1)?.name).toBe('Etherscan');
  });

  it('returns null for local and unknown chains instead of another network', () => {
    expect(getExplorerTxUrl('0xabc', 31337)).toBeNull();
    expect(getExplorerTxUrl('0xabc', 999)).toBeNull();
  });
});
