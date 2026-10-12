import type { JsonValue } from '@feed/shared';
import type { Experience } from '../types';

export interface ExperienceRelationship {
  fromId: string;
  toId: string;
  type: 'causes' | 'contradicts' | 'supports' | 'supersedes' | 'related';
  strength: number; // 0-1
  metadata?: Record<string, JsonValue>;
}

export class ExperienceRelationshipManager {
  private relationships: Map<string, ExperienceRelationship[]> = new Map();

  /** Add or replace the edge identified by (fromId, toId, type). */
  addRelationship(relationship: ExperienceRelationship): void {
    const { fromId, toId, type } = relationship;
    const edges = (this.relationships.get(fromId) ?? []).filter(
      (r) => !(r.toId === toId && r.type === type)
    );
    edges.push({ ...relationship });
    this.relationships.set(fromId, edges);
  }

  /** Drop every edge from or to an experience that no longer exists. */
  removeExperience(experienceId: string): void {
    this.relationships.delete(experienceId);
    for (const [fromId, edges] of this.relationships) {
      const kept = edges.filter((r) => r.toId !== experienceId);
      if (kept.length === 0) this.relationships.delete(fromId);
      else if (kept.length !== edges.length)
        this.relationships.set(fromId, kept);
    }
  }

  findRelationships(
    experienceId: string,
    type?: string
  ): ExperienceRelationship[] {
    const rels = this.relationships.get(experienceId) ?? [];
    return (type ? rels.filter((r) => r.type === type) : rels).map((r) => ({
      ...r,
    }));
  }

  findContradictions(
    experience: Experience,
    allExperiences: Experience[]
  ): Experience[] {
    const explicit = new Set(
      this.findRelationships(experience.id, 'contradicts').map((r) => r.toId)
    );

    return allExperiences.filter(
      (other) =>
        other.id !== experience.id &&
        // Same action, different outcome — or an explicit contradiction edge.
        ((other.action === experience.action &&
          other.outcome !== experience.outcome &&
          other.domain === experience.domain) ||
          explicit.has(other.id))
    );
  }
}
