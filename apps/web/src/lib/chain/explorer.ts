/**
 * Block Explorer URL Utilities
 *
 * Chain-aware URLs for viewing transactions on block explorers. Supports
 * Ethereum mainnet, Sepolia, Base mainnet and Base Sepolia. Local (31337) and
 * unknown chains have no explorer: callers get null and render no link,
 * rather than a link to an unrelated network.
 */

import { getCurrentChainId } from '@feed/shared';

interface ExplorerInfo {
  name: string;
  baseUrl: string;
}

const EXPLORERS: Readonly<Record<number, ExplorerInfo>> = {
  1: { name: 'Etherscan', baseUrl: 'https://etherscan.io' },
  11155111: { name: 'Etherscan', baseUrl: 'https://sepolia.etherscan.io' },
  8453: { name: 'BaseScan', baseUrl: 'https://basescan.org' },
  84532: { name: 'BaseScan', baseUrl: 'https://sepolia.basescan.org' },
};

/** Explorer for a chain, or null when the chain has none (local/unknown). */
export function getExplorer(
  chainId: number = getCurrentChainId()
): ExplorerInfo | null {
  return EXPLORERS[chainId] ?? null;
}

/** Transaction URL on the current chain's explorer, or null if unsupported. */
export function getExplorerTxUrl(
  txHash: string,
  chainId: number = getCurrentChainId()
): string | null {
  const explorer = getExplorer(chainId);
  return explorer
    ? `${explorer.baseUrl}/tx/${encodeURIComponent(txHash)}`
    : null;
}
