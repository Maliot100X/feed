/**
 * NPC System Validation Tests
 *
 * @module testing/integration/npc-system-validation.test
 *
 * @description
 * Comprehensive tests that validate NPC system behavior including:
 * - Investment manager portfolio allocation
 * - Persona generation and assignment
 * - Trading decision logic
 *
 * **Output Files:**
 * - .output/npc-persona-assignments-{timestamp}.json
 * - .output/npc-trading-decisions-{timestamp}.json
 */

import { beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// Import NPC system components
import { NPCPersonaGenerator, StaticDataRegistry } from '@feed/engine';
import { logger } from '@feed/shared';

// Set timeout
setDefaultTimeout(60000);

// Output directory setup
const OUTPUT_DIR = join(process.cwd(), '.output');
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');

function ensureOutputDir() {
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

function writeOutput(filename: string, data: unknown) {
  ensureOutputDir();
  const filepath = join(OUTPUT_DIR, `${filename}-${TIMESTAMP}.json`);
  writeFileSync(filepath, JSON.stringify(data, null, 2));
  logger.info(`Output written to ${filepath}`, undefined, 'NPCTest');
  return filepath;
}

describe('NPC System Validation Tests', () => {
  beforeAll(() => {
    ensureOutputDir();
    logger.info(
      `Starting NPC system tests. Output dir: ${OUTPUT_DIR}`,
      undefined,
      'NPCTest'
    );
  });

  describe('NPCPersonaGenerator', () => {
    test('assigns personas to actors', () => {
      const generator = new NPCPersonaGenerator();

      // Get some actors from static registry
      const actors = StaticDataRegistry.getAllActors().slice(0, 10);
      const organizations = StaticDataRegistry.getAllOrganizations();

      const personas = generator.assignPersonas(
        actors.map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          domain: a.domain,
          personality: a.personality,
          role: 'supporting' as const,
          affiliations: a.affiliations,
          tier: a.tier ?? undefined,
        })),
        organizations.map((o) => ({
          id: o.id,
          name: o.name,
          ticker: o.ticker,
          description: o.description,
          type: o.type,
          canBeInvolved: o.canBeInvolved,
        }))
      );

      expect(personas.size).toBeGreaterThan(0);

      // Validate persona structure
      for (const [actorId, persona] of personas) {
        expect(actorId).toBeDefined();
        expect(typeof persona.reliability).toBe('number');
        expect(persona.reliability).toBeGreaterThanOrEqual(0);
        expect(persona.reliability).toBeLessThanOrEqual(1);
        expect(Array.isArray(persona.insiderOrgs)).toBe(true);
        expect(typeof persona.willingToLie).toBe('boolean');
        expect(typeof persona.selfInterest).toBe('string');
      }
    });

    test('outputs persona assignments for all actors', () => {
      const generator = new NPCPersonaGenerator();

      const actors = StaticDataRegistry.getAllActors();
      const organizations = StaticDataRegistry.getAllOrganizations();

      const personas = generator.assignPersonas(
        actors.map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          domain: a.domain,
          personality: a.personality,
          role: 'supporting' as const,
          affiliations: a.affiliations,
          tier: a.tier ?? undefined,
        })),
        organizations.map((o) => ({
          id: o.id,
          name: o.name,
          ticker: o.ticker,
          description: o.description,
          type: o.type,
          canBeInvolved: o.canBeInvolved,
        }))
      );

      const personaOutput = {
        totalActors: actors.length,
        totalPersonas: personas.size,
        stats: {
          avgReliability: 0,
          insiderCount: 0,
          liarCount: 0,
          reliabilityDistribution: {
            low: 0, // 0-0.3
            medium: 0, // 0.3-0.7
            high: 0, // 0.7-1.0
          },
        },
        personas: [] as {
          actorId: string;
          actorName: string;
          reliability: number;
          insiderOrgs: string[];
          willingToLie: boolean;
          selfInterest: string;
          expertise: string[];
          favorsActors: string[];
          opposesActors: string[];
        }[],
      };

      let totalReliability = 0;

      for (const [actorId, persona] of personas) {
        const actor = actors.find((a) => a.id === actorId);
        totalReliability += persona.reliability;

        if (persona.insiderOrgs.length > 0) {
          personaOutput.stats.insiderCount++;
        }
        if (persona.willingToLie) {
          personaOutput.stats.liarCount++;
        }

        if (persona.reliability < 0.3) {
          personaOutput.stats.reliabilityDistribution.low++;
        } else if (persona.reliability < 0.7) {
          personaOutput.stats.reliabilityDistribution.medium++;
        } else {
          personaOutput.stats.reliabilityDistribution.high++;
        }

        personaOutput.personas.push({
          actorId,
          actorName: actor?.name || 'Unknown',
          reliability: persona.reliability,
          insiderOrgs: persona.insiderOrgs,
          willingToLie: persona.willingToLie,
          selfInterest: persona.selfInterest,
          expertise: persona.expertise,
          favorsActors: persona.favorsActors,
          opposesActors: persona.opposesActors,
        });
      }

      personaOutput.stats.avgReliability = totalReliability / personas.size;

      writeOutput('npc-persona-assignments', personaOutput);

      expect(personaOutput.totalPersonas).toBeGreaterThan(0);
      expect(personaOutput.stats.avgReliability).toBeGreaterThan(0);
    });

    test('insiders have appropriate org affiliations', () => {
      const generator = new NPCPersonaGenerator();

      const actors = StaticDataRegistry.getAllActors().slice(0, 20);
      const organizations = StaticDataRegistry.getAllOrganizations();

      const personas = generator.assignPersonas(
        actors.map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          domain: a.domain,
          personality: a.personality,
          role: 'supporting' as const,
          affiliations: a.affiliations,
          tier: a.tier ?? undefined,
        })),
        organizations.map((o) => ({
          id: o.id,
          name: o.name,
          ticker: o.ticker,
          description: o.description,
          type: o.type,
          canBeInvolved: o.canBeInvolved,
        }))
      );

      const orgIds = new Set(organizations.map((o) => o.id));

      // Validate insider orgs are real organizations
      for (const [_actorId, persona] of personas) {
        for (const insiderOrg of persona.insiderOrgs) {
          expect(orgIds.has(insiderOrg)).toBe(true);
        }
      }
    });
  });

  describe('StaticDataRegistry', () => {
    test('returns all actors', () => {
      const actors = StaticDataRegistry.getAllActors();

      expect(actors).toBeDefined();
      expect(Array.isArray(actors)).toBe(true);
      expect(actors.length).toBeGreaterThan(0);

      // Validate actor structure
      for (const actor of actors.slice(0, 10)) {
        expect(actor.id).toBeDefined();
        expect(actor.name).toBeDefined();
        expect(actor.description).toBeDefined();
      }
    });

    test('returns all organizations', () => {
      const organizations = StaticDataRegistry.getAllOrganizations();

      expect(organizations).toBeDefined();
      expect(Array.isArray(organizations)).toBe(true);
      expect(organizations.length).toBeGreaterThan(0);

      // Validate organization structure
      for (const org of organizations) {
        expect(org.id).toBeDefined();
        expect(org.name).toBeDefined();
        expect(org.type).toBeDefined();
      }
    });

    test('returns organizations by type', () => {
      const companies = StaticDataRegistry.getOrganizationsByType('company');
      const media = StaticDataRegistry.getOrganizationsByType('media');
      const government =
        StaticDataRegistry.getOrganizationsByType('government');

      expect(companies.length).toBeGreaterThanOrEqual(0);
      expect(media.length).toBeGreaterThanOrEqual(0);
      expect(government.length).toBeGreaterThanOrEqual(0);

      // All should be of correct type
      for (const company of companies) {
        expect(company.type).toBe('company');
      }
      for (const m of media) {
        expect(m.type).toBe('media');
      }
      for (const g of government) {
        expect(g.type).toBe('government');
      }
    });

    test('gets actor by id', () => {
      const allActors = StaticDataRegistry.getAllActors();
      expect(allActors.length).toBeGreaterThan(0);

      const firstActor = allActors[0]!;
      const retrieved = StaticDataRegistry.getActor(firstActor.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(firstActor.id);
      expect(retrieved?.name).toBe(firstActor.name);
    });

    test('outputs static data registry summary', () => {
      const actors = StaticDataRegistry.getAllActors();
      const organizations = StaticDataRegistry.getAllOrganizations();

      const registryOutput = {
        actorCount: actors.length,
        organizationCount: organizations.length,
        actorsByTier: {} as Record<string, number>,
        organizationsByType: {} as Record<string, number>,
        sampleActors: actors.slice(0, 10).map((a) => ({
          id: a.id,
          name: a.name,
          tier: a.tier,
          domain: a.domain,
          affiliationCount: a.affiliations?.length || 0,
        })),
        sampleOrganizations: organizations.slice(0, 10).map((o) => ({
          id: o.id,
          name: o.name,
          type: o.type,
          ticker: o.ticker,
        })),
      };

      // Count by tier
      for (const actor of actors) {
        const tier = actor.tier || 'UNKNOWN';
        registryOutput.actorsByTier[tier] =
          (registryOutput.actorsByTier[tier] || 0) + 1;
      }

      // Count by type
      for (const org of organizations) {
        registryOutput.organizationsByType[org.type] =
          (registryOutput.organizationsByType[org.type] || 0) + 1;
      }

      writeOutput('static-data-registry', registryOutput);

      expect(registryOutput.actorCount).toBeGreaterThan(0);
      expect(registryOutput.organizationCount).toBeGreaterThan(0);
    });
  });
});
