import { describe, expect, test } from 'bun:test';
import { EventBus } from '../EventBus';

describe('EventBus', () => {
  test('sync handler/filter throws do not abort delivery to other subscribers', async () => {
    const bus = new EventBus();
    const received: string[] = [];
    bus.subscribe('a.b', () => {
      throw new Error('sync boom');
    });
    bus.subscribe(
      'a.b',
      () => {
        received.push('filtered');
      },
      () => {
        throw new Error('filter boom');
      }
    );
    bus.subscribe('a.b', async () => {
      throw new Error('async boom');
    });
    bus.subscribe('a.b', () => {
      received.push('ok');
    });

    await bus.publish('a.b', { x: 1 });
    expect(received).toEqual(['ok']);
  });

  test('wildcard patterns treat regex metacharacters literally', async () => {
    const bus = new EventBus();
    const hits: string[] = [];
    bus.subscribe('chat[1].*', (data) => {
      hits.push(String(data));
    });
    await bus.publish('chat[1].msg', 'literal');
    await bus.publish('chat1.msg', 'class-match');
    expect(hits).toEqual(['literal']);
  });

  test('getHistory limit 0 returns nothing; invalid limits throw', async () => {
    const bus = new EventBus();
    await bus.publish('x', 1);
    await bus.publish('x', 2);
    expect(bus.getHistory('x', 0)).toEqual([]);
    expect(bus.getHistory('x', 1).map((e) => e.data)).toEqual([2]);
    expect(() => bus.getHistory('x', -1)).toThrow();
    expect(() => bus.getHistory('x', Number.NaN)).toThrow();
  });

  test('getHistory applies predicate before the limit', async () => {
    const bus = new EventBus();
    await bus.publish('x', { team: 'a' });
    for (let i = 0; i < 5; i++) await bus.publish('x', { team: 'b' });
    const scoped = bus.getHistory(
      'x',
      2,
      (e) =>
        typeof e.data === 'object' &&
        e.data !== null &&
        !Array.isArray(e.data) &&
        e.data.team === 'a'
    );
    expect(scoped).toHaveLength(1);
  });
});
