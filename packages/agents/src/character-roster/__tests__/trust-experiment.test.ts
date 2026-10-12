import { describe, expect, it } from 'bun:test';
import {
  buildTrustExperimentAgents,
  buildTrustExperimentManifest,
} from '../trust-experiment';

describe('trust experiment matrix', () => {
  it('builds a 100-agent matrix across requested model sizes', () => {
    const agents = buildTrustExperimentAgents({
      agentCount: 100,
      archetypeCount: 30,
      modelSizes: ['0.5b', '3b', '14b', '30b'],
    });

    expect(agents.length).toBe(100);
    expect(new Set(agents.map((agent) => agent.sheet.username)).size).toBe(100);
    expect(new Set(agents.map((agent) => agent.modelProfile.id)).size).toBe(4);
  });

  it('builds a manifest with aligned breakdown counts', () => {
    const manifest = buildTrustExperimentManifest({
      agentCount: 24,
      archetypeCount: 12,
      modelSizes: ['0.5b', '1.5b', '3b'],
      npcTargetCount: 150,
    });

    const totalFromBreakdown = Object.values(manifest.modelBreakdown).reduce(
      (sum, count) => sum + count,
      0
    );

    expect(manifest.agentTargetCount).toBe(24);
    expect(manifest.npcTargetCount).toBe(150);
    expect(totalFromBreakdown).toBe(24);
  });

  it('keeps training model metadata while routing runtime through provider models', () => {
    const [agent] = buildTrustExperimentAgents({
      agentCount: 1,
      archetypeCount: 1,
      modelSizes: ['0.5b'],
    });

    expect(agent.sheet.settings.model).toBe('Qwen/Qwen2.5-0.5B-Instruct');
    expect(agent.sheet.settings.groq.primary).toBe('llama-3.1-8b-instant');
    expect(agent.sheet.feed.datasetTags).toContain(
      'runtime_model:llama-3.1-8b-instant'
    );
  });

  it('crosses every archetype with every model cohort when count permits', () => {
    const modelSizes = ['0.5b', '3b', '14b'] as const;
    const agents = buildTrustExperimentAgents({
      agentCount: 30,
      archetypeCount: 10,
      modelSizes: [...modelSizes],
    });

    const byArchetype = new Map<string, Set<string>>();
    for (const agent of agents) {
      const set = byArchetype.get(agent.archetypeId) ?? new Set<string>();
      set.add(agent.modelProfile.id);
      byArchetype.set(agent.archetypeId, set);
    }
    expect(byArchetype.size).toBe(10);
    for (const models of byArchetype.values()) {
      expect([...models].sort()).toEqual([...modelSizes].sort());
    }
    expect(new Set(agents.map((a) => a.instanceId)).size).toBe(30);
    expect(agents.every((a) => a.variantIndex === 1)).toBe(true);
  });

  it('keeps the identifying username suffix and uniqueness under truncation', () => {
    const agents = buildTrustExperimentAgents({
      agentCount: 200,
      archetypeCount: 30,
    });
    const usernames = agents.map((a) => a.sheet.username);
    expect(new Set(usernames).size).toBe(usernames.length);
    for (const agent of agents) {
      expect(agent.sheet.username.length).toBeLessThanOrEqual(32);
      expect(
        agent.sheet.username.endsWith(
          `_${agent.modelProfile.id.replace('.', '_')}v${agent.variantIndex}`
        )
      ).toBe(true);
    }
  });

  it('rejects invalid counts and model lists synchronously', () => {
    expect(() => buildTrustExperimentAgents({ agentCount: 0 })).toThrow();
    expect(() =>
      buildTrustExperimentAgents({ agentCount: Number.POSITIVE_INFINITY })
    ).toThrow();
    expect(() => buildTrustExperimentAgents({ agentCount: 1.5 })).toThrow();
    expect(() => buildTrustExperimentAgents({ archetypeCount: 0 })).toThrow();
    expect(() => buildTrustExperimentAgents({ modelSizes: [] })).toThrow();
    expect(() =>
      buildTrustExperimentAgents({ modelSizes: ['3b', '3b'] })
    ).toThrow();
  });

  it('reports the actual archetype count in the manifest', () => {
    const manifest = buildTrustExperimentManifest({
      agentCount: 5,
      archetypeCount: 30,
      modelSizes: ['0.5b'],
    });
    expect(manifest.archetypeCount).toBe(5);
  });

  it('is deterministic across builds', () => {
    const a = buildTrustExperimentAgents({ agentCount: 20 });
    const b = buildTrustExperimentAgents({ agentCount: 20 });
    expect(a.map((x) => x.instanceId)).toEqual(b.map((x) => x.instanceId));
  });
});
