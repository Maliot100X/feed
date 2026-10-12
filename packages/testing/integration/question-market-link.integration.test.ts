import { afterAll, describe, expect, test } from 'bun:test';
import { PredictionDbAdapter } from '@feed/core/markets/prediction';
import { db, eq, inArray, markets, questions } from '@feed/db';
import { gameService } from '../../engine/src/game-service';

const prefix = `question-link-${crypto.randomUUID()}`;
const questionIds: string[] = [];
const marketIds: string[] = [];
let questionNumber = 1_700_000_000 + Math.floor(Math.random() * 100_000_000);

async function createQuestion(suffix: string) {
  const id = `${prefix}-${suffix}`;
  questionIds.push(id);
  const [question] = await db
    .insert(questions)
    .values({
      id,
      questionNumber: questionNumber++,
      text: 'Will the robotaxi launch be cancelled?',
      scenarioId: 1,
      outcome: false,
      rank: 1,
      resolutionDate: new Date(Date.now() + 86400000),
      updatedAt: new Date(),
    })
    .returning();
  if (!question) throw new Error('Test question was not created');
  return { ...question, status: 'active' as const };
}

afterAll(async () => {
  if (questionIds.length)
    await db.delete(questions).where(inArray(questions.id, questionIds));
  if (marketIds.length)
    await db.delete(markets).where(inArray(markets.id, marketIds));
});

describe('question market links', () => {
  test('creation links atomically and edited text retains the feed join', async () => {
    const question = await createQuestion('creation');
    marketIds.push(question.id);
    const adapter = new PredictionDbAdapter();
    const market = await adapter.createMarketFromQuestion(question, 1000);
    await db
      .update(questions)
      .set({ text: 'Edited punctuation!' })
      .where(eq(questions.id, question.id));
    const [joined] = await db
      .select({ id: markets.id, text: questions.text })
      .from(questions)
      .leftJoin(markets, eq(markets.id, questions.marketId))
      .where(eq(questions.id, question.id));
    expect(joined).toEqual({ id: market.id, text: 'Edited punctuation!' });
    expect(await gameService.getQuestionOutcome(market.id)).toBe(false);
  });

  test('concurrent creation preserves one market and its link', async () => {
    const question = await createQuestion('concurrent');
    marketIds.push(question.id);
    const adapter = new PredictionDbAdapter();
    const results = await Promise.all([
      adapter.createMarketFromQuestion(question, 1000),
      adapter.createMarketFromQuestion(question, 1000),
    ]);
    expect(results.map((market) => market.id)).toEqual([
      question.id,
      question.id,
    ]);
    const [linked] = await db
      .select({ marketId: questions.marketId })
      .from(questions)
      .where(eq(questions.id, question.id));
    expect(linked?.marketId).toBe(question.id);
  });

  test('failed linking rolls back market creation', async () => {
    const id = `${prefix}-missing`;
    marketIds.push(id);
    await expect(
      new PredictionDbAdapter().createMarketFromQuestion(
        {
          id,
          text: 'Missing question',
          status: 'active',
          resolutionDate: new Date(),
        },
        1000
      )
    ).rejects.toThrow('Question not found');
    expect(await new PredictionDbAdapter().getMarketById(id)).toBeNull();
  });

  test('NPC summaries and outcomes follow a link with different question and market IDs', async () => {
    const question = await createQuestion('legacy');
    const marketId = `${prefix}-different-market`;
    marketIds.push(marketId);
    await db.insert(markets).values({
      id: marketId,
      question: 'Old wording',
      liquidity: '1000',
      endDate: question.resolutionDate,
      updatedAt: new Date(),
    });
    await db
      .update(questions)
      .set({ marketId })
      .where(eq(questions.id, question.id));
    expect(await gameService.getQuestionOutcome(marketId)).toBe(false);
    const summaries = await gameService.getActiveMarketSummaries(10000);
    expect(summaries.find((summary) => summary.id === marketId)).toEqual({
      id: marketId,
      questionId: question.id,
      question: question.text,
    });
    await db.delete(markets).where(eq(markets.id, marketId));
    const [unlinked] = await db
      .select({ marketId: questions.marketId })
      .from(questions)
      .where(eq(questions.id, question.id));
    expect(unlinked?.marketId).toBeNull();
    expect(await gameService.getQuestionOutcome(marketId)).toBeNull();
  });
});
