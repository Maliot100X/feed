/**
 * Unit Tests for DISPATCH_TO_AGENT action
 *
 * Tests every branch of the action's validate() and handler().
 * Co-located with the source so that relative mock paths resolve correctly.
 *
 * validate():
 * - Returns false when teamMembers is absent from state
 * - Returns false when teamMembers is empty
 * - Returns false when all members are non-agents
 * - Returns true when at least one member is an agent
 * - Returns true when agents are mixed with non-agent members
 *
 * handler():
 * - Returns error ActionResult when agentId is missing
 * - Returns error ActionResult when command is missing
 * - Returns error ActionResult when ownerId is missing
 * - Returns error ActionResult when teamChatId is missing
 * - Returns error ActionResult when broadcastFn is missing
 * - Calls dispatchAgentChat with exact parameters from state
 * - Returns success ActionResult with truncated response in text
 * - Returns failure ActionResult when dispatch fails
 * - text falls back to agentId when agentUsername is not set
 * - text uses agentUsername when available
 * - values contains dispatchedCommand, agentResponse, actionsExecuted
 * - Calls _callback with the ActionResult on all paths (success, failure, missing fields)
 *   and awaits it before resolving
 *
 * Authorization (agent belongs to the owner's team) is enforced inside
 * dispatchAgentChat and is not certified by these mocked tests.
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { IAgentRuntime, Memory, State } from '@elizaos/core';

// ─── Mock dispatchAgentChat ───────────────────────────────────────────────────
// Co-located with the source — this relative path matches exactly what
// dispatch-to-agent.ts uses: import { dispatchAgentChat } from '../../../../services/AgentChatService'
// Since this test is in the same directory, the relative path resolves identically.

const mockDispatchAgentChat =
  mock<(params: Record<string, unknown>) => Promise<Record<string, unknown>>>();

mock.module('../../../../services/AgentChatService', () => ({
  dispatchAgentChat: mockDispatchAgentChat,
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

const { dispatchToAgentAction } = await import('./dispatch-to-agent');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const AGENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OWNER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const TEAM_CHAT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const buildState = (
  overrides: {
    teamMembers?: unknown;
    actionParams?: unknown;
    broadcastFn?: unknown;
    ownerId?: string;
    teamChatId?: string;
  } = {}
): State => {
  // Use `in` to distinguish "explicitly passed as undefined" from "not passed at all"
  return {
    values: {
      ownerId: 'ownerId' in overrides ? overrides.ownerId : OWNER_ID,
      teamChatId:
        'teamChatId' in overrides ? overrides.teamChatId : TEAM_CHAT_ID,
      ownerName: 'Alice',
      ownerUsername: 'alice',
    },
    data: {
      teamMembers:
        'teamMembers' in overrides
          ? overrides.teamMembers
          : [{ isAgent: true, id: AGENT_ID, username: 'trading_bot' }],
      actionParams:
        'actionParams' in overrides
          ? overrides.actionParams
          : { agentId: AGENT_ID, command: 'open a 2x long on TSLAI for $100' },
      broadcastFn:
        'broadcastFn' in overrides
          ? overrides.broadcastFn
          : mock(async () => undefined),
    },
  } as unknown as State;
};

const MOCK_RUNTIME = {} as IAgentRuntime;
const MOCK_MESSAGE = {} as Memory;

beforeEach(() => {
  // Reset implementations too, so no case inherits another case's result
  mockDispatchAgentChat.mockReset();
});

// ─── validate() ───────────────────────────────────────────────────────────────

describe('DISPATCH_TO_AGENT validate()', () => {
  it('returns false when state is undefined', async () => {
    const result = await dispatchToAgentAction.validate!(
      MOCK_RUNTIME,
      MOCK_MESSAGE,
      undefined
    );
    expect(result).toBe(false);
  });

  it('returns false when teamMembers is absent from state.data', async () => {
    const state = buildState({ teamMembers: undefined });
    const result = await dispatchToAgentAction.validate!(
      MOCK_RUNTIME,
      MOCK_MESSAGE,
      state
    );
    expect(result).toBe(false);
  });

  it('returns false when teamMembers is an empty array', async () => {
    const state = buildState({ teamMembers: [] });
    const result = await dispatchToAgentAction.validate!(
      MOCK_RUNTIME,
      MOCK_MESSAGE,
      state
    );
    expect(result).toBe(false);
  });

  it('returns false when all members are non-agents (human users)', async () => {
    const state = buildState({
      teamMembers: [
        { isAgent: false, id: 'user-1', username: 'alice' },
        { isAgent: false, id: 'user-2', username: 'bob' },
      ],
    });
    const result = await dispatchToAgentAction.validate!(
      MOCK_RUNTIME,
      MOCK_MESSAGE,
      state
    );
    expect(result).toBe(false);
  });

  it('returns true when exactly one agent exists', async () => {
    const state = buildState({
      teamMembers: [{ isAgent: true, id: AGENT_ID, username: 'bot' }],
    });
    const result = await dispatchToAgentAction.validate!(
      MOCK_RUNTIME,
      MOCK_MESSAGE,
      state
    );
    expect(result).toBe(true);
  });

  it('returns true when agents are mixed with non-agent members', async () => {
    const state = buildState({
      teamMembers: [
        { isAgent: false, id: 'user-1', username: 'alice' },
        { isAgent: true, id: AGENT_ID, username: 'bot' },
        { isAgent: false, id: 'user-3', username: 'charlie' },
      ],
    });
    const result = await dispatchToAgentAction.validate!(
      MOCK_RUNTIME,
      MOCK_MESSAGE,
      state
    );
    expect(result).toBe(true);
  });

  it('returns true when multiple agents exist', async () => {
    const state = buildState({
      teamMembers: [
        { isAgent: true, id: 'agent-1', username: 'bot1' },
        { isAgent: true, id: 'agent-2', username: 'bot2' },
      ],
    });
    const result = await dispatchToAgentAction.validate!(
      MOCK_RUNTIME,
      MOCK_MESSAGE,
      state
    );
    expect(result).toBe(true);
  });
});

// ─── handler() ────────────────────────────────────────────────────────────────

describe('DISPATCH_TO_AGENT handler()', () => {
  // ── Missing required fields ─────────────────────────────────────────────

  describe('missing required state fields', () => {
    const cases: Array<[string, Parameters<typeof buildState>[0]]> = [
      ['agentId', { actionParams: { command: 'open long' } }],
      ['command', { actionParams: { agentId: AGENT_ID } }],
      [
        'whitespace command',
        { actionParams: { agentId: AGENT_ID, command: '   ' } },
      ],
      ['actionParams', { actionParams: undefined }],
      ['ownerId', { ownerId: undefined }],
      ['teamChatId', { teamChatId: undefined }],
      ['broadcastFn', { broadcastFn: undefined }],
    ];

    for (const [missing, overrides] of cases) {
      it(`fails without dispatching when ${missing} is missing`, async () => {
        const callbackFn = mock(async () => []);
        const result = await dispatchToAgentAction.handler!(
          MOCK_RUNTIME,
          MOCK_MESSAGE,
          buildState(overrides),
          {},
          callbackFn
        );
        expect(result!.success).toBe(false);
        expect(result!.text).toContain('Missing');
        expect(mockDispatchAgentChat).not.toHaveBeenCalled();
        expect(callbackFn).toHaveBeenCalledTimes(1);
      });
    }
  });

  // ── Successful dispatch ─────────────────────────────────────────────────

  describe('successful dispatch', () => {
    const LONG_RESPONSE =
      'I have successfully opened a 2x leveraged long position on TSLAI. ' +
      'The trade was executed at market price with $100 margin. ' +
      'Your position is now active and being monitored. ' +
      'Stop loss set at 5% below entry. Take profit at 10% above entry.';

    beforeEach(() => {
      mockDispatchAgentChat.mockResolvedValue({
        success: true,
        agentId: AGENT_ID,
        agentUsername: 'trading_bot',
        response: LONG_RESPONSE,
        actionsExecuted: 2,
        isLLMFailure: false,
      });
    });

    it('calls dispatchAgentChat with correct parameters from state', async () => {
      const state = buildState();
      await dispatchToAgentAction.handler!(
        MOCK_RUNTIME,
        MOCK_MESSAGE,
        state,
        {},
        mock()
      );

      expect(mockDispatchAgentChat).toHaveBeenCalledTimes(1);
      const callArg = mockDispatchAgentChat.mock.calls[0]![0];
      expect(callArg.agentId).toBe(AGENT_ID);
      expect(callArg.ownerId).toBe(OWNER_ID);
      expect(callArg.teamChatId).toBe(TEAM_CHAT_ID);
      expect(callArg.message).toBe('open a 2x long on TSLAI for $100');
      expect(callArg.ownerName).toBe('Alice');
      expect(callArg.ownerUsername).toBe('alice');
      expect(typeof callArg.broadcastFn).toBe('function');
    });

    it('returns success ActionResult', async () => {
      const state = buildState();
      const result = await dispatchToAgentAction.handler!(
        MOCK_RUNTIME,
        MOCK_MESSAGE,
        state,
        {},
        mock()
      );
      expect(result!.success).toBe(true);
    });

    it('text includes agent username and truncated response', async () => {
      const state = buildState();
      const result = await dispatchToAgentAction.handler!(
        MOCK_RUNTIME,
        MOCK_MESSAGE,
        state,
        {},
        mock()
      );
      expect(result!.text).toContain('@trading_bot');
      expect(result!.text).toContain(LONG_RESPONSE.slice(0, 100));
    });

    it('text embeds exactly the first 300 chars while values keep the full response', async () => {
      const veryLongResponse = `${'X'.repeat(300)}${'Y'.repeat(200)}`;
      mockDispatchAgentChat.mockResolvedValue({
        success: true,
        agentId: AGENT_ID,
        agentUsername: 'bot',
        response: veryLongResponse,
        actionsExecuted: 1,
        isLLMFailure: false,
      });

      const state = buildState();
      const result = await dispatchToAgentAction.handler!(
        MOCK_RUNTIME,
        MOCK_MESSAGE,
        state,
        {},
        mock()
      );

      expect(result!.text).toBe(`Dispatched to @bot: "${'X'.repeat(300)}"`);
      expect((result!.values as Record<string, unknown>).agentResponse).toBe(
        veryLongResponse
      );
    });

    it('values contains correct dispatch data', async () => {
      const state = buildState();
      const result = await dispatchToAgentAction.handler!(
        MOCK_RUNTIME,
        MOCK_MESSAGE,
        state,
        {},
        mock()
      );

      expect(result!.values).toMatchObject({
        agentId: AGENT_ID,
        agentUsername: 'trading_bot',
        dispatchedCommand: 'open a 2x long on TSLAI for $100',
        agentResponse: LONG_RESPONSE,
        actionsExecuted: 2,
      });
    });

    it('text falls back to agentId when agentUsername is not set', async () => {
      mockDispatchAgentChat.mockResolvedValue({
        success: true,
        agentId: AGENT_ID,
        agentUsername: undefined,
        response: 'Done.',
        actionsExecuted: 0,
        isLLMFailure: false,
      });

      const state = buildState();
      const result = await dispatchToAgentAction.handler!(
        MOCK_RUNTIME,
        MOCK_MESSAGE,
        state,
        {},
        mock()
      );

      expect(result!.text).toContain(AGENT_ID);
    });
  });

  // ── Failed dispatch ─────────────────────────────────────────────────────

  describe('failed dispatch', () => {
    it('returns failure ActionResult when dispatchAgentChat returns success=false', async () => {
      mockDispatchAgentChat.mockResolvedValue({
        success: false,
        error: 'Agent runtime unavailable',
        actionsExecuted: 0,
        isLLMFailure: true,
      });

      const state = buildState();
      const result = await dispatchToAgentAction.handler!(
        MOCK_RUNTIME,
        MOCK_MESSAGE,
        state,
        {},
        mock()
      );

      expect(result!.success).toBe(false);
      expect(result!.text).toContain('Agent runtime unavailable');
    });

    it('includes agentId and command in failure values for tracing', async () => {
      mockDispatchAgentChat.mockResolvedValue({
        success: false,
        error: 'Ownership check failed',
        actionsExecuted: 0,
        isLLMFailure: false,
      });

      const state = buildState();
      const result = await dispatchToAgentAction.handler!(
        MOCK_RUNTIME,
        MOCK_MESSAGE,
        state,
        {},
        mock()
      );

      expect(result!.values).toBeDefined();
      expect((result!.values as Record<string, unknown>).agentId).toBe(
        AGENT_ID
      );
      expect((result!.values as Record<string, unknown>).command).toBe(
        'open a 2x long on TSLAI for $100'
      );
    });
  });

  // ── _callback contract ──────────────────────────────────────────────────

  describe('_callback contract (ElizaOS protocol)', () => {
    it('awaits the callback before resolving', async () => {
      mockDispatchAgentChat.mockResolvedValue({
        success: true,
        agentId: AGENT_ID,
        agentUsername: 'bot',
        response: 'Done.',
        actionsExecuted: 0,
        isLLMFailure: false,
      });
      let release: () => void = () => {};
      const callbackFn = mock(
        () =>
          new Promise<[]>((resolve) => {
            release = () => resolve([]);
          })
      );

      let settled = false;
      const pending = dispatchToAgentAction.handler!(
        MOCK_RUNTIME,
        MOCK_MESSAGE,
        buildState(),
        {},
        callbackFn
      ).then(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(settled).toBe(false);

      release();
      await pending;
      expect(settled).toBe(true);
      expect(mockDispatchAgentChat).toHaveBeenCalledTimes(1);
    });

    it('propagates a thrown dispatch without reporting success', async () => {
      mockDispatchAgentChat.mockRejectedValue(new Error('runtime crashed'));
      const callbackFn = mock(async () => []);

      await expect(
        dispatchToAgentAction.handler!(
          MOCK_RUNTIME,
          MOCK_MESSAGE,
          buildState(),
          {},
          callbackFn
        )
      ).rejects.toThrow('runtime crashed');
      expect(callbackFn).not.toHaveBeenCalled();
    });

    it('calls _callback with success result on successful dispatch', async () => {
      mockDispatchAgentChat.mockResolvedValue({
        success: true,
        agentId: AGENT_ID,
        agentUsername: 'bot',
        response: 'Done.',
        actionsExecuted: 0,
        isLLMFailure: false,
      });

      const callbackFn = mock(async () => []);
      const state = buildState();

      await dispatchToAgentAction.handler!(
        MOCK_RUNTIME,
        MOCK_MESSAGE,
        state,
        {},
        callbackFn
      );

      expect(callbackFn).toHaveBeenCalledTimes(1);
      const callArg = callbackFn.mock.calls[0]![0] as unknown as {
        content: { success: boolean };
      };
      expect(callArg.content.success).toBe(true);
    });

    it('calls _callback with failure result on missing fields (error path)', async () => {
      const callbackFn = mock(async () => []);
      const state = buildState({ actionParams: undefined });

      await dispatchToAgentAction.handler!(
        MOCK_RUNTIME,
        MOCK_MESSAGE,
        state,
        {},
        callbackFn
      );

      expect(callbackFn).toHaveBeenCalledTimes(1);
      const callArg = callbackFn.mock.calls[0]![0] as unknown as {
        content: { success: boolean; text: string };
      };
      expect(callArg.content.success).toBe(false);
      expect(callArg.content.text).toContain('Missing');
    });

    it('calls _callback with failure result when dispatch fails', async () => {
      mockDispatchAgentChat.mockResolvedValue({
        success: false,
        error: 'Failed',
        actionsExecuted: 0,
        isLLMFailure: false,
      });

      const callbackFn = mock(async () => []);
      const state = buildState();

      await dispatchToAgentAction.handler!(
        MOCK_RUNTIME,
        MOCK_MESSAGE,
        state,
        {},
        callbackFn
      );

      expect(callbackFn).toHaveBeenCalledTimes(1);
      const callArg = callbackFn.mock.calls[0]![0] as unknown as {
        content: { success: boolean; text: string };
      };
      expect(callArg.content.success).toBe(false);
      expect(callArg.content.text).toContain('Failed');
    });
  });
});
