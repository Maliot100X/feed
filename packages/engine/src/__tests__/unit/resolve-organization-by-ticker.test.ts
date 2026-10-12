import { describe, expect, it } from 'bun:test';
import type { StaticOrganization } from '../../services/static-data-registry';
import { resolveOrganizationByTicker } from '../../services/trade-execution-service';

const org = (
  id: string,
  name: string,
  ticker?: string
): StaticOrganization => ({
  id,
  name,
  ticker,
  description: '',
  type: 'company',
  canBeInvolved: true,
  initialPrice: 100,
});

const orgs = [
  org('openagi', 'OpenAGI', 'OPENAGI'),
  org('nvidai', 'NvidAI', 'NVDAI'),
  org('tesla-motors', 'Teslah Motors', 'TSLAH'),
];

describe('resolveOrganizationByTicker', () => {
  it('resolves exact id, ticker and normalized name', () => {
    expect(resolveOrganizationByTicker('nvidai', orgs)?.id).toBe('nvidai');
    expect(resolveOrganizationByTicker('nvdai', orgs)?.id).toBe('nvidai');
    expect(resolveOrganizationByTicker('$OPENAGI', orgs)?.id).toBe('openagi');
    expect(resolveOrganizationByTicker('Teslah Motors', orgs)?.id).toBe(
      'tesla-motors'
    );
  });

  it('never selects an organization for blank or punctuation-only identifiers', () => {
    expect(resolveOrganizationByTicker('', orgs)).toBeUndefined();
    expect(resolveOrganizationByTicker('  $ ', orgs)).toBeUndefined();
  });

  it('does not match on substrings', () => {
    expect(resolveOrganizationByTicker('a', orgs)).toBeUndefined();
    expect(resolveOrganizationByTicker('NV', orgs)).toBeUndefined();
  });

  it('rejects ambiguous identifiers', () => {
    const dupes = [...orgs, org('nvdai', 'Other Org')];
    expect(() => resolveOrganizationByTicker('NVDAI!', dupes)).not.toThrow();
    const ambiguous = [
      org('acme-1', 'Acme', 'ACME'),
      org('acme-2', 'Acme 2', 'ACME'),
    ];
    expect(() => resolveOrganizationByTicker('acme', ambiguous)).toThrow(
      /Ambiguous/
    );
  });
});
