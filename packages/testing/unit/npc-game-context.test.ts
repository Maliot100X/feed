import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { getSignalDirection } from '../../engine/src/services/narrative-state-service';

let outcome: boolean | null = false;
let lookupError: Error | null = null;
const arcPlan = {
  id: 'arc',
  questionId: 'question-1',
  uncertaintyPeakDay: 2,
  clarityOnsetDay: 4,
  verificationDay: 7,
  createdAt: new Date(),
  insiderActorIds: ['insider'],
  deceiverActorIds: ['deceiver'],
  phaseRatios: { early: 0.43, middle: 0.55, late: 0.78, climax: 1 },
  eventSchedule: [],
};
const getArcPlan = mock(async (_id: string) => arcPlan);
const claim = 'Will the robotaxi launch be cancelled?';
mock.module('@feed/engine', () => ({
  getSignalDirection,
  getArcPhaseForDay: () => 'early',
  getArcPlan,
  StaticDataRegistry: {
    getActor: (id: string) => (id === 'user' ? null : { id, name: id }),
    getAllActors: () => [],
  },
  worldFactsService: { generateWorldContext: async () => ({ general: '' }) },
  gameService: {
    getActiveMarketSummaries: async () => [
      { id: 'market-1', questionId: 'question-1', question: claim },
    ],
    getCurrentGameDay: async () => 1,
    getQuestionOutcome: async () => {
      if (lookupError) throw lookupError;
      return outcome;
    },
  },
}));
const { getNpcGameContext } = await import(
  '../../agents/src/plugins/feed/providers/npc-game-context'
);

beforeEach(() => {
  outcome = false;
  lookupError = null;
  getArcPlan.mockClear();
});

describe('NPC outcome context', () => {
  for (const actualOutcome of [false, true]) {
    test(`insiders follow and deceivers oppose ${actualOutcome ? 'YES' : 'NO'} outcomes in rendered prompts`, async () => {
      outcome = actualOutcome;
      const insider = await getNpcGameContext('insider');
      const deceiver = await getNpcGameContext('deceiver');
      expect(insider).toContain(
        `claim to ${actualOutcome ? 'come true' : 'not come true'}: "${claim}"`
      );
      expect(deceiver).toContain(
        `claim to ${actualOutcome ? 'not come true' : 'come true'}: "${claim}"`
      );
      expect(getArcPlan).toHaveBeenCalledWith('question-1');
    });
  }
  test('missing outcomes do not fabricate YES signals', async () => {
    outcome = null;
    await expect(getNpcGameContext('insider')).rejects.toThrow(
      'Missing question outcome'
    );
  });
  test('database failures propagate', async () => {
    lookupError = new Error('database unavailable');
    await expect(getNpcGameContext('insider')).rejects.toThrow(
      'database unavailable'
    );
  });
  test('user agents receive no privileged context', async () => {
    expect(await getNpcGameContext('user')).toBe('');
    expect(getArcPlan).not.toHaveBeenCalled();
  });
});
