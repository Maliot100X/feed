import { describe, expect, it } from 'bun:test';
import { QuestionArcPlanner } from '../services/question-arc-planner';
import type { Question } from '../types';

function seededRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const question: Question = {
  id: 1,
  text: 'Will TechCorp ship the product?',
  scenario: 1,
  outcome: true,
  rank: 1,
};

describe('QuestionArcPlanner phase targets', () => {
  it('declared phase targets match the generated schedule, red herrings included', () => {
    for (const seed of [1, 7, 42, 1234]) {
      const plan = new QuestionArcPlanner().planQuestionArc(
        question,
        [],
        [],
        seededRng(seed)
      );

      const declaredTotal = Object.values(plan.phases).reduce(
        (sum, phase) => sum + phase.targetEventsTotal,
        0
      );
      expect(declaredTotal).toBe(plan.eventSchedule.length);

      for (const phase of Object.values(plan.phases)) {
        const [start, end] = phase.daysRange;
        const inPhase = plan.eventSchedule.filter(
          (e) => e.baseDay >= start && e.baseDay <= end
        );
        expect(inPhase).toHaveLength(phase.targetEventsTotal);
        expect(inPhase.filter((e) => e.signalDirection === 'NO')).toHaveLength(
          phase.targetWrongSignals
        );
      }
    }
  });
});
