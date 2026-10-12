import { describe, expect, test } from 'bun:test';
import { ChatCreateSchema } from '../../shared/src/validation/schemas/chat';

const group = {
  name: 'Members',
  isGroup: true,
  participantIds: ['123456789012345678'],
};

describe('chat creation after collectible removal', () => {
  test('keeps ordinary group and direct-chat creation', () => {
    expect(ChatCreateSchema.parse(group)).toEqual(group);
    expect(
      ChatCreateSchema.parse({ participantIds: group.participantIds }).isGroup
    ).toBe(false);
  });

  test('rejects retired security settings instead of silently dropping the gate', () => {
    for (const retiredSetting of [
      { nftGated: true },
      {
        requiredNftContractAddress:
          '0x0000000000000000000000000000000000000001',
      },
      { requiredNftTokenId: 1 },
      { requiredNftChainId: 1 },
    ]) {
      expect(
        ChatCreateSchema.safeParse({ ...group, ...retiredSetting }).success
      ).toBe(false);
    }
  });
});
