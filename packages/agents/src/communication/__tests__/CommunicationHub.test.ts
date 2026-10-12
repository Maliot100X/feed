import { describe, expect, test } from 'bun:test';
import { CommunicationHub } from '../CommunicationHub';
import { EventBus } from '../EventBus';

describe('CommunicationHub', () => {
  test('a zero history limit returns no entries and invalid limits are rejected', () => {
    const hub = new CommunicationHub(new EventBus());
    expect(hub.getMessageHistory(undefined, 0)).toEqual([]);
    expect(hub.getRouteHistory(undefined, 0)).toEqual([]);
    expect(() => hub.getMessageHistory(undefined, -1)).toThrow(RangeError);
    expect(() => hub.getRouteHistory(undefined, 1.5)).toThrow(RangeError);
  });

  test('async message handlers are awaited by publish', async () => {
    const bus = new EventBus();
    const hub = new CommunicationHub(bus);
    let handled = false;
    hub.subscribeToMessages('recipient', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      handled = true;
    });
    await bus.publish('agent.recipient.message', {
      id: 'm1',
      from: 'sender',
      to: 'recipient',
      type: 'chat',
      content: 'hello',
      timestamp: new Date().toISOString(),
      metadata: {},
    });
    expect(handled).toBe(true);
  });
});
