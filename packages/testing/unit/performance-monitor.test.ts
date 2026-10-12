import { describe, expect, it, spyOn } from 'bun:test';
import { PerformanceMonitor } from '../../api/src/monitoring/performance-monitor';

describe('PerformanceMonitor', () => {
  it('computes requests per second over the elapsed window', () => {
    let now = 1_000_000;
    const monitor = new PerformanceMonitor(() => now);
    for (let i = 0; i < 30; i++) monitor.startRequest();
    now += 10_000;
    expect(monitor.getStats().system.requestsPerSecond).toBe(3);
  });

  it('reports zero rate (not Infinity/NaN) for an empty window', () => {
    const monitor = new PerformanceMonitor(() => 5);
    expect(monitor.getStats().system.requestsPerSecond).toBe(0);
  });

  it('bounds retained latency samples', () => {
    const monitor = new PerformanceMonitor();
    for (let i = 0; i < 5000; i++) {
      monitor.recordCacheOperation('get', true, i < 4000 ? 1000 : 1);
    }
    // Only the most recent 1000 samples (all 1ms) remain.
    expect(monitor.getStats().cache.avgLatencyMs).toBe(1);
  });

  it('does not record history when reading stats', () => {
    const monitor = new PerformanceMonitor();
    monitor.getStats();
    monitor.identifyBottlenecks();
    monitor.getRecommendations();
    expect(monitor.getSnapshots()).toHaveLength(0);
    monitor.takeSnapshot();
    expect(monitor.getSnapshots()).toHaveLength(1);
  });

  it('skips process metrics on Workers, where they throw', () => {
    const previous = process.env.DEPLOYMENT_PLATFORM;
    process.env.DEPLOYMENT_PLATFORM = 'cloudflare';
    const notImplemented = () => {
      throw new Error('ERR_METHOD_NOT_IMPLEMENTED');
    };
    const cpu = spyOn(process, 'cpuUsage').mockImplementation(notImplemented);
    const memory = spyOn(process, 'memoryUsage').mockImplementation(
      Object.assign(notImplemented, { rss: notImplemented })
    );
    try {
      const monitor = new PerformanceMonitor();
      const stats = monitor.getStats();
      expect(stats.system.cpuUsagePercent).toBe(0);
      expect(cpu).not.toHaveBeenCalled();
      expect(memory).not.toHaveBeenCalled();
    } finally {
      cpu.mockRestore();
      memory.mockRestore();
      if (previous === undefined) delete process.env.DEPLOYMENT_PLATFORM;
      else process.env.DEPLOYMENT_PLATFORM = previous;
    }
  });
});
