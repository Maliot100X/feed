import { describe, expect, it } from 'bun:test';
import { mostAccessibleTier } from '../services/alpha-group-invite-service';

describe('mostAccessibleTier', () => {
  it('does not downgrade a Tier 1-eligible fast-track user to Tier 2', () => {
    expect(mostAccessibleTier(1, 2)).toBe(1);
  });

  it('lets fast-track lift a user above their normal tier', () => {
    expect(mostAccessibleTier(3, 2)).toBe(2);
    expect(mostAccessibleTier(null, 3)).toBe(3);
  });
});
