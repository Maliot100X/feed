/**
 * Deployment Validation Utilities
 *
 * Validate that contracts are deployed and working correctly.
 * This file contains only browser-compatible code.
 *
 * @remarks For Node.js file system operations (saveDeployment, updateEnvFile),
 * import from '@feed/contracts/deployment/validation-node'.
 */

import { ethers } from 'ethers';
import type { DeploymentEnv } from './env-detection';
import { logger } from './logger';

/**
 * Contract addresses for a deployment.
 *
 * Includes all core contracts and optional components that may be deployed.
 */
export interface ContractAddresses {
  /** Diamond proxy contract address */
  diamond: string;
  /** DiamondCut facet address */
  diamondCutFacet: string;
  /** DiamondLoupe facet address */
  diamondLoupeFacet: string;
  /** PredictionMarket facet address */
  predictionMarketFacet: string;
  /** Oracle facet address */
  oracleFacet: string;
  /** LiquidityPool facet address (optional) */
  liquidityPoolFacet?: string;
  /** PerpetualMarket facet address (optional) */
  perpetualMarketFacet?: string;
  /** ReferralSystem facet address (optional) */
  referralSystemFacet?: string;
  /** ERC-8004 Identity Registry address */
  identityRegistry: string;
  /** ERC-8004 Reputation System address */
  reputationSystem: string;
  /** Feed Game Oracle address (optional) */
  feedOracle?: string;
  /** Ban Manager address (optional) */
  banManager?: string;
  /** Chainlink Oracle mock address (testnet only) */
  chainlinkOracle?: string;
  /** Mock Oracle address (testnet only) */
  mockOracle?: string;
  /** Test ERC20 token address (testnet only) */
  testToken?: string;
}

export interface DeploymentInfo {
  network: string;
  chainId: number;
  contracts: ContractAddresses;
  deployer: string;
  timestamp: string;
  blockNumber?: number;
  gasUsed?: string;
  explorer?: Record<string, string>;
}

export interface ValidationResult {
  valid: boolean;
  deployed: boolean;
  errors: string[];
  warnings: string[];
  contracts: Partial<ContractAddresses>;
}

/**
 * Load deployment information from module imports.
 *
 * @param env - Deployment environment to load
 * @returns Deployment info or null if not found
 */
export async function loadDeployment(
  env: DeploymentEnv
): Promise<DeploymentInfo | null> {
  let data: object;
  if (env === 'localnet') {
    data = (await import('../../deployments/local')).default;
  } else if (env === 'testnet') {
    data = (await import('../../deployments/base-sepolia')).default;
  } else if (env === 'mainnet') {
    data = (await import('../../deployments/base')).default;
  } else {
    return null;
  }

  // Undeployed networks ship an empty JSON object.
  return isDeploymentInfo(data) ? data : null;
}

function isDeploymentInfo(data: object): data is DeploymentInfo {
  return (
    'chainId' in data &&
    typeof data.chainId === 'number' &&
    'contracts' in data &&
    typeof data.contracts === 'object' &&
    data.contracts !== null
  );
}

/** Contracts every deployment must provide. */
const REQUIRED_CONTRACTS = [
  'diamond',
  'identityRegistry',
  'reputationSystem',
] as const satisfies ReadonlyArray<keyof ContractAddresses>;

function hasBytecode(code: string): boolean {
  return code !== '0x' && code !== '0x0';
}

/**
 * Validate contract deployment
 */
export async function validateDeployment(
  env: DeploymentEnv,
  rpcUrl: string,
  expectedContracts?: Partial<ContractAddresses>
): Promise<ValidationResult> {
  const deployment = await loadDeployment(env);

  if (!deployment) {
    return {
      valid: false,
      deployed: false,
      errors: [
        `No deployment found for ${env}`,
        'Run the deployment script to deploy contracts',
      ],
      warnings: [],
      contracts: {},
    };
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  try {
    return await validateDeploymentWithProvider(
      provider,
      deployment,
      expectedContracts
    );
  } finally {
    provider.destroy();
  }
}

/**
 * Validate a loaded deployment against a provider. Every listed contract
 * address must have bytecode; the required core contracts must be listed.
 * An empty expectation set is a failure, never a vacuous pass.
 */
export async function validateDeploymentWithProvider(
  provider: Pick<ethers.Provider, 'getNetwork' | 'getCode' | 'call'>,
  deployment: Pick<DeploymentInfo, 'chainId' | 'contracts'>,
  expectedContracts?: Partial<ContractAddresses>
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const contracts: Partial<ContractAddresses> = {};

  const network = await provider.getNetwork();
  const deploymentChainId = BigInt(deployment.chainId);
  if (network.chainId !== deploymentChainId) {
    errors.push(
      `Chain ID mismatch: provider is ${network.chainId}, deployment is ${deploymentChainId}`
    );
  }

  const contractsToValidate = expectedContracts ?? deployment.contracts;
  const entries = (
    Object.entries(contractsToValidate) as Array<
      [keyof ContractAddresses, string | undefined]
    >
  ).filter((entry): entry is [keyof ContractAddresses, string] =>
    Boolean(entry[1])
  );

  if (entries.length === 0) {
    errors.push('No contract addresses to validate');
  }
  if (!expectedContracts) {
    for (const name of REQUIRED_CONTRACTS) {
      if (!contractsToValidate[name]) {
        errors.push(`Required contract ${name} has no address`);
      }
    }
  }

  for (const [name, address] of entries) {
    if (!ethers.isAddress(address)) {
      errors.push(`${name} has an invalid address: ${address}`);
      continue;
    }
    const code = await provider.getCode(address);
    if (!hasBytecode(code)) {
      errors.push(`${name} not deployed at ${address}`);
      continue;
    }
    contracts[name] = address;
    logger.info(
      `✅ ${name} verified at ${address}`,
      undefined,
      'DeploymentValidation'
    );
  }

  if (contracts.diamond) {
    // Smoke-call a diamond view so a proxy without facets fails validation.
    const iface = new ethers.Interface([
      'function getBalance(address) view returns (uint256)',
    ]);
    const result = await provider.call({
      to: contracts.diamond,
      data: iface.encodeFunctionData('getBalance', [ethers.ZeroAddress]),
    });
    iface.decodeFunctionResult('getBalance', result);
    logger.info(
      '✅ Diamond contract is functional',
      undefined,
      'DeploymentValidation'
    );
  }

  return {
    valid: errors.length === 0,
    deployed: Object.keys(contracts).length > 0,
    errors,
    warnings,
    contracts,
  };
}

/**
 * Check if a contract is deployed at an address
 */
export async function isContractDeployed(
  rpcUrl: string,
  address: string
): Promise<boolean> {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  try {
    return hasBytecode(await provider.getCode(address));
  } finally {
    provider.destroy();
  }
}

/**
 * Print deployment validation result
 */
export function printDeploymentValidationResult(
  result: ValidationResult,
  env: DeploymentEnv
): void {
  if (!result.deployed) {
    logger.error(
      `❌ No contracts deployed for ${env}`,
      undefined,
      'DeploymentValidation'
    );
    for (const error of result.errors) {
      logger.error(`   ${error}`, undefined, 'DeploymentValidation');
    }

    logger.info(
      '\nTo deploy contracts, run:',
      undefined,
      'DeploymentValidation'
    );
    logger.info(
      `   bun run contracts:deploy:${env === 'testnet' ? 'testnet' : env === 'mainnet' ? 'mainnet' : 'local'}`,
      undefined,
      'DeploymentValidation'
    );
    throw new Error(`No contracts deployed for ${env}`);
  }

  if (result.warnings.length > 0) {
    logger.warn('Warnings:', undefined, 'DeploymentValidation');
    for (const warning of result.warnings) {
      logger.warn(`  ⚠️  ${warning}`, undefined, 'DeploymentValidation');
    }
  }

  if (result.errors.length > 0) {
    logger.error('Validation errors:', undefined, 'DeploymentValidation');
    for (const error of result.errors) {
      logger.error(`  ❌ ${error}`, undefined, 'DeploymentValidation');
    }
    throw new Error('Contract validation failed');
  }

  if (!result.valid) {
    throw new Error('Contract validation failed');
  }

  logger.info(
    '✅ All contracts validated successfully',
    undefined,
    'DeploymentValidation'
  );
}

/**
 * Wait for transaction confirmation.
 *
 * A transaction mined in the latest block has one confirmation.
 *
 * @param provider - Ethers provider instance
 * @param txHash - Transaction hash to wait for
 * @param confirmations - Number of confirmations required (default: 1)
 * @param timeoutMs - Maximum time to wait (default: 5 minutes)
 * @returns The successful transaction receipt
 * @throws Error if the transaction reverted or the timeout is reached
 */
export async function waitForTransaction(
  provider: Pick<ethers.Provider, 'waitForTransaction'>,
  txHash: string,
  confirmations = 1,
  timeoutMs = 5 * 60 * 1000
): Promise<ethers.TransactionReceipt> {
  logger.info(
    `Waiting for transaction ${txHash}...`,
    undefined,
    'DeploymentValidation'
  );

  const receipt = await provider.waitForTransaction(
    txHash,
    confirmations,
    timeoutMs
  );
  if (!receipt) {
    throw new Error(`Transaction ${txHash} was not mined`);
  }
  if (receipt.status !== 1) {
    throw new Error(`Transaction ${txHash} reverted`);
  }

  logger.info(
    `✅ Transaction confirmed (${confirmations} confirmations)`,
    undefined,
    'DeploymentValidation'
  );
  return receipt;
}
