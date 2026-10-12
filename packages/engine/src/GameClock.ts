/**
 * Injectable game clock for deterministic time handling.
 * Supports realtime mode (actual wall clock) and simulated mode (fast-forward).
 */

export interface GameTime {
  timestamp: Date;
  tick: number;
  day: number;
  hour: number;
  minute: number;
}

export interface GameClockConfig {
  mode: 'realtime' | 'simulated';
  /** For simulated mode: starting timestamp */
  startTime?: Date;
  /** Game start date (day 1). Defaults to startTime. */
  gameStartDate?: Date;
}

function requireValidDate(value: Date, name: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`GameClock: ${name} must be a valid Date`);
  }
  return new Date(value.getTime());
}

export class GameClock {
  private mode: 'realtime' | 'simulated';
  private startTime: Date;
  private gameStartDate: Date;
  private currentTick = 0;
  private simulatedTime: Date;

  constructor(config: GameClockConfig = { mode: 'realtime' }) {
    this.mode = config.mode;
    this.startTime = requireValidDate(
      config.startTime ?? new Date(),
      'startTime'
    );
    // Day 1 defaults to the clock's start so historical simulations count from their own epoch.
    this.gameStartDate = requireValidDate(
      config.gameStartDate ?? this.startTime,
      'gameStartDate'
    );
    this.simulatedTime = new Date(this.startTime.getTime());
  }

  /** Get current game time */
  now(): GameTime {
    // Return a copy so callers can never mutate the simulated clock.
    const timestamp =
      this.mode === 'realtime'
        ? new Date()
        : new Date(this.simulatedTime.getTime());
    return this.timestampToGameTime(timestamp);
  }

  /** Advance one tick (for simulated mode) */
  tick(): GameTime {
    this.currentTick++;

    if (this.mode === 'simulated') {
      // Each tick = 1 hour in game time
      this.simulatedTime = new Date(
        this.simulatedTime.getTime() + 60 * 60 * 1000
      );
    }

    return this.now();
  }

  /** Convert timestamp to game time (day/hour/minute) */
  timestampToGameTime(timestamp: Date): GameTime {
    const msElapsed = timestamp.getTime() - this.gameStartDate.getTime();
    const hoursElapsed = msElapsed / (1000 * 60 * 60);
    const daysElapsed = Math.floor(hoursElapsed / 24);

    return {
      timestamp,
      tick: this.currentTick,
      day: daysElapsed + 1, // Day 1 = first day
      hour: Math.floor(hoursElapsed % 24),
      minute: Math.floor((msElapsed / (1000 * 60)) % 60),
    };
  }

  /** Set simulated time to specific point */
  setTime(timestamp: Date): void {
    if (this.mode !== 'simulated') {
      throw new Error('Cannot set time in realtime mode');
    }
    this.simulatedTime = requireValidDate(timestamp, 'timestamp');
  }

  /** Fast-forward by N hours (simulated mode only) */
  advanceHours(hours: number): GameTime {
    if (this.mode !== 'simulated') {
      throw new Error('Cannot advance time in realtime mode');
    }
    if (!Number.isSafeInteger(hours) || hours < 0) {
      throw new Error('GameClock: hours must be a non-negative integer');
    }
    this.simulatedTime = new Date(
      this.simulatedTime.getTime() + hours * 60 * 60 * 1000
    );
    this.currentTick += hours;
    return this.now();
  }

  /** Fast-forward by N days (simulated mode only) */
  advanceDays(days: number): GameTime {
    return this.advanceHours(days * 24);
  }

  /** Get current tick number */
  getCurrentTick(): number {
    return this.currentTick;
  }

  /** Check if clock is in simulated mode */
  isSimulated(): boolean {
    return this.mode === 'simulated';
  }

  /** Create a realtime clock */
  static realtime(gameStartDate?: Date): GameClock {
    return new GameClock({
      mode: 'realtime',
      gameStartDate: gameStartDate ?? new Date(),
    });
  }

  /** Create a simulated clock for testing/training */
  static simulated(startTime?: Date, gameStartDate?: Date): GameClock {
    return new GameClock({
      mode: 'simulated',
      startTime: startTime ?? new Date(),
      gameStartDate: gameStartDate ?? startTime ?? new Date(),
    });
  }
}
