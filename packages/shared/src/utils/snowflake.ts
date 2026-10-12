/**
 * Snowflake ID Generator
 *
 * @description Generates unique 64-bit IDs similar to Twitter's Snowflake system.
 * Provides distributed ID generation with timestamp ordering and worker isolation.
 *
 * Structure (64 bits total):
 * - 1 bit: Always 0 (sign bit for compatibility)
 * - 41 bits: Timestamp in milliseconds since custom epoch (2024-01-01)
 * - 10 bits: Worker/Machine ID (0-1023)
 * - 12 bits: Sequence number (0-4095)
 *
 * This allows for:
 * - 69 years of timestamps (from epoch)
 * - 1024 different workers/machines
 * - 4096 IDs per millisecond per worker
 * - Total: ~4 million IDs per second per worker
 */

// Custom epoch: January 1, 2024 00:00:00 UTC
const EPOCH = 1704067200000n; // BigInt for precision

// Bit lengths
const WORKER_BITS = 10n;
const SEQUENCE_BITS = 12n;

// Maximum values
const MAX_WORKER_ID = (1n << WORKER_BITS) - 1n; // 1023
const MAX_SEQUENCE = (1n << SEQUENCE_BITS) - 1n; // 4095

// Bit shifts
const TIMESTAMP_SHIFT = WORKER_BITS + SEQUENCE_BITS; // 22
const WORKER_SHIFT = SEQUENCE_BITS; // 12

/**
 * Snowflake ID Generator Class
 *
 * @description Generates unique, ordered IDs using the Snowflake algorithm.
 * Generation is synchronous (JavaScript runs it to completion without
 * interleaving), so no queue or mutex is needed for in-process uniqueness.
 * Cross-process uniqueness requires each process to use a distinct WORKER_ID.
 */
class SnowflakeGenerator {
  private workerId: bigint;
  private sequence = 0n;
  private lastTimestamp = 0n;

  constructor(workerId = 0) {
    if (
      !Number.isInteger(workerId) ||
      workerId < 0 ||
      workerId > Number(MAX_WORKER_ID)
    ) {
      throw new Error(
        `Worker ID must be an integer between 0 and ${MAX_WORKER_ID}`
      );
    }
    this.workerId = BigInt(workerId);
  }

  /**
   * Generate a new Snowflake ID.
   * Rejects (without wedging later calls) if the clock moved backwards.
   */
  async generate(): Promise<string> {
    return this.generateSync();
  }

  /**
   * Generate a new Snowflake ID (synchronous internal method)
   */
  private generateSync(): string {
    let timestamp = BigInt(Date.now()) - EPOCH;

    // Timestamp should never go backwards. Check before mutating state so a
    // rollback leaves the generator usable once the clock recovers.
    if (timestamp < this.lastTimestamp) {
      throw new Error('Clock moved backwards. Refusing to generate ID.');
    }

    // If same millisecond, increment sequence
    if (timestamp === this.lastTimestamp) {
      this.sequence = (this.sequence + 1n) & MAX_SEQUENCE;

      // If sequence overflow, wait for next millisecond
      if (this.sequence === 0n) {
        timestamp = this.waitNextMillis(timestamp);
      }
    } else {
      // New millisecond, reset sequence
      this.sequence = 0n;
    }

    this.lastTimestamp = timestamp;

    // Construct the ID (ensure decimal string for BigInt() compatibility across runtimes)
    const id =
      (timestamp << TIMESTAMP_SHIFT) |
      (this.workerId << WORKER_SHIFT) |
      this.sequence;

    return String(id).trim();
  }

  /**
   * Wait for the next millisecond
   */
  private waitNextMillis(lastTimestamp: bigint): bigint {
    let timestamp = BigInt(Date.now()) - EPOCH;
    while (timestamp <= lastTimestamp) {
      timestamp = BigInt(Date.now()) - EPOCH;
    }
    return timestamp;
  }

  /**
   * Parse a Snowflake ID to extract its components
   */
  static parse(id: string | bigint): {
    timestamp: Date;
    workerId: number;
    sequence: number;
  } {
    const idBigInt = typeof id === 'string' ? BigInt(id.trim()) : id;

    const timestamp = (idBigInt >> TIMESTAMP_SHIFT) + EPOCH;
    const workerId = (idBigInt >> WORKER_SHIFT) & MAX_WORKER_ID;
    const sequence = idBigInt & MAX_SEQUENCE;

    return {
      timestamp: new Date(Number(timestamp)),
      workerId: Number(workerId),
      sequence: Number(sequence),
    };
  }

  /**
   * Check if a string is a valid Snowflake ID
   */
  static isValid(id: string): boolean {
    const s = id.trim();
    if (s === '') return false;
    try {
      const idBigInt = BigInt(s);
      if (idBigInt < 0n || idBigInt >= 1n << 63n) {
        return false;
      }
      SnowflakeGenerator.parse(idBigInt);
      return true;
    } catch {
      return false;
    }
  }
}

// Singleton instance - uses worker ID from environment or defaults to 0
let instance: SnowflakeGenerator | null = null;

/**
 * Get or create the global Snowflake generator instance
 */
function getGenerator(): SnowflakeGenerator {
  if (!instance) {
    const workerId = process.env.WORKER_ID ? Number(process.env.WORKER_ID) : 0;
    instance = new SnowflakeGenerator(workerId);
  }
  return instance;
}

/**
 * Generate a new Snowflake ID (convenience function)
 */
export async function generateSnowflakeId(): Promise<string> {
  return await getGenerator().generate();
}

/**
 * Parse a Snowflake ID (convenience function)
 */
export function parseSnowflakeId(id: string | bigint) {
  return SnowflakeGenerator.parse(id);
}

/**
 * Check if a string is a valid Snowflake ID (convenience function)
 */
export function isValidSnowflakeId(id: string): boolean {
  return SnowflakeGenerator.isValid(id);
}

export { SnowflakeGenerator };
