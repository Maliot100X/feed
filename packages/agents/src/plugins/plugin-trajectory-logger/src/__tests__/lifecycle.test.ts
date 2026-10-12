import { beforeEach, describe, expect, it, mock } from 'bun:test';

const insertedRows: Array<{ table: unknown; row: Record<string, unknown> }> =
  [];
let llmWriteGate: Promise<void> = Promise.resolve();
let releaseLlmWrite: () => void = () => {};

const llmCallLogs = { __name: 'llmCallLogs' };
const trajectories = { __name: 'trajectories' };

mock.module('@feed/db', () => ({
  llmCallLogs,
  trajectories,
  db: {
    insert: (table: unknown) => ({
      values: async (row: Record<string, unknown>) => {
        if (table === llmCallLogs) {
          await llmWriteGate;
        }
        insertedRows.push({ table, row });
      },
    }),
  },
}));

mock.module('@feed/training', () => ({
  computeDeterministicRewardJudgment: () => ({
    overallScore: 0,
    componentScores: {},
  }),
  upsertRewardJudgment: async () => {},
}));

const { TrajectoryLoggerService } = await import('../TrajectoryLoggerService');

const envState = { agentBalance: 100, agentPnL: 0, openPositions: 0 };
const action = {
  actionType: 'trade',
  actionName: 'BUY',
  parameters: {},
  success: true,
};

describe('TrajectoryLoggerService lifecycle', () => {
  beforeEach(() => {
    insertedRows.length = 0;
    llmWriteGate = Promise.resolve();
  });

  it('ignores a repeated completeStep instead of adding the reward twice', () => {
    const service = new TrajectoryLoggerService();
    const trajectoryId = service.startTrajectory('agent-1');
    const stepId = service.startStep(trajectoryId, envState);

    service.completeStep(trajectoryId, stepId, action, { reward: 1 });
    service.completeStep(trajectoryId, stepId, action, { reward: 1 });

    expect(service.getActiveTrajectory(trajectoryId)?.totalReward).toBe(1);
  });

  it('completing an older step keeps the newer step current', () => {
    const service = new TrajectoryLoggerService();
    const trajectoryId = service.startTrajectory('agent-1');
    const older = service.startStep(trajectoryId, envState);
    const newer = service.startStep(trajectoryId, envState);

    service.completeStep(trajectoryId, older, action);

    expect(service.getCurrentStepId(trajectoryId)).toBe(newer);
  });

  it('keeps reserved metrics and persists a trajectory only once', async () => {
    const service = new TrajectoryLoggerService();
    const trajectoryId = service.startTrajectory('agent-1');
    service.startStep(trajectoryId, envState);

    await service.endTrajectory(trajectoryId, 'timeout', {
      finalStatus: 'completed',
      episodeLength: 99,
      finalPnL: 5,
    });
    await service.endTrajectory(trajectoryId, 'completed');

    const saved = insertedRows.filter((r) => r.table === trajectories);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.row.finalStatus).toBe('timeout');
    expect(saved[0]?.row.episodeLength).toBe(1);
    expect(saved[0]?.row.finalPnL).toBe(5);
  });

  it('stop() waits for in-flight LLM call writes and keeps zero token counts', async () => {
    llmWriteGate = new Promise<void>((resolve) => {
      releaseLlmWrite = resolve;
    });
    const service = new TrajectoryLoggerService();
    const trajectoryId = service.startTrajectory('agent-1');
    const stepId = service.startStep(trajectoryId, envState);

    service.logLLMCall(stepId, {
      model: 'm',
      systemPrompt: 's',
      userPrompt: 'u',
      response: 'r',
      temperature: 0,
      maxTokens: 10,
      purpose: 'action',
      promptTokens: 0,
      completionTokens: 0,
      metadata: { purpose: 'spoofed' },
    });

    let stopped = false;
    const stopping = service.stop().then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(stopped).toBe(false);

    releaseLlmWrite();
    await stopping;

    const call = insertedRows.find((r) => r.table === llmCallLogs);
    expect(call?.row.promptTokens).toBe(0);
    expect(call?.row.totalTokens).toBe(0);
    expect(JSON.parse(call?.row.metadata as string).purpose).toBe('action');
  });
});
