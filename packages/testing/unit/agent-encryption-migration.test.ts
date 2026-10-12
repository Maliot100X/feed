import { afterEach, expect, test } from 'bun:test';
import { ExternalAgentAdapter } from '../../agents/src/external/ExternalAgentAdapter';
import { AgentRegistryService } from '../../agents/src/services/agent-registry.service';

const previousCron = process.env.CRON_SECRET;
const previousEncryption = process.env.AGENT_ENCRYPTION_KEY;
afterEach(() => {
  if (previousCron === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previousCron;
  if (previousEncryption === undefined) delete process.env.AGENT_ENCRYPTION_KEY;
  else process.env.AGENT_ENCRYPTION_KEY = previousEncryption;
});

test('existing agent credentials survive a scheduler secret rotation', () => {
  const registry = new AgentRegistryService();
  const adapter = new ExternalAgentAdapter();
  const oldKey = 'legacy-encryption-key-for-fixture';
  process.env.CRON_SECRET = oldKey;
  delete process.env.AGENT_ENCRYPTION_KEY;
  const encrypted = registry['encryptCredentials'](
    'existing-agent-api-credential'
  );
  process.env.CRON_SECRET = 'new-scheduler-secret-for-fixture';
  process.env.AGENT_ENCRYPTION_KEY = oldKey;
  expect(registry['decryptCredentials'](encrypted)).toBe(
    'existing-agent-api-credential'
  );
  expect(adapter['decryptCredentials'](encrypted)).toBe(
    'existing-agent-api-credential'
  );
});
