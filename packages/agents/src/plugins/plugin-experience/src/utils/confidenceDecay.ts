import type { Experience } from '../types';

export interface DecayConfig {
  halfLife: number; // Time in milliseconds for confidence to decay by half
  minConfidence: number; // Minimum confidence level (never decays below this)
  decayStartDelay: number; // Time before decay starts (grace period)
}

const DEFAULT_DECAY_CONFIG: DecayConfig = {
  halfLife: 30 * 24 * 60 * 60 * 1000, // 30 days
  minConfidence: 0.1, // 10% minimum
  decayStartDelay: 7 * 24 * 60 * 60 * 1000, // 7 days grace period
};

export class ConfidenceDecayManager {
  private config: DecayConfig;

  constructor(config: Partial<DecayConfig> = {}) {
    this.config = { ...DEFAULT_DECAY_CONFIG, ...config };
    if (!Number.isFinite(this.config.halfLife) || this.config.halfLife <= 0) {
      throw new Error('DecayConfig.halfLife must be a finite positive number');
    }
    if (
      !Number.isFinite(this.config.decayStartDelay) ||
      this.config.decayStartDelay < 0
    ) {
      throw new Error(
        'DecayConfig.decayStartDelay must be a finite non-negative number'
      );
    }
  }

  /**
   * Calculate the decayed confidence for an experience.
   *
   * Decay never increases confidence: the floor is capped at the experience's
   * original confidence.
   */
  getDecayedConfidence(
    experience: Experience,
    now: number = Date.now()
  ): number {
    const age = now - experience.createdAt;
    const specificConfig = this.getDomainSpecificDecay(experience);

    // No decay during grace period
    if (age < specificConfig.decayStartDelay) {
      return experience.confidence;
    }

    // Calculate decay based on half-life
    const decayTime = age - specificConfig.decayStartDelay;
    const halfLives = decayTime / specificConfig.halfLife;
    const decayFactor = Math.pow(0.5, halfLives);

    // Apply decay but respect minimum (which can never exceed the original)
    const decayedConfidence = experience.confidence * decayFactor;
    const floor = Math.min(specificConfig.minConfidence, experience.confidence);
    return Math.max(floor, decayedConfidence);
  }

  /**
   * Adjust decay rate based on experience type and domain
   */
  getDomainSpecificDecay(experience: Experience): DecayConfig {
    const config = { ...this.config };

    // Facts and discoveries decay slower
    if (experience.type === 'discovery' || experience.type === 'learning') {
      config.halfLife *= 2; // Double the half-life
    }

    // Warnings and corrections decay slower (important to remember)
    if (experience.type === 'warning' || experience.type === 'correction') {
      config.halfLife *= 1.5;
      config.minConfidence = 0.2; // Higher minimum
    }

    // Domain-specific adjustments
    switch (experience.domain) {
      case 'security':
      case 'safety':
        config.halfLife *= 3; // Security lessons decay very slowly
        config.minConfidence = 0.3;
        break;
      case 'performance':
        config.halfLife *= 0.5; // Performance insights may change quickly
        break;
      case 'user_preference':
        config.halfLife *= 0.7; // User preferences can change
        break;
    }

    return config;
  }
}
