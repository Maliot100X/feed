#!/usr/bin/env bun
/** Run real NPC runtimes against a local audit DB, retaining every model call. */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { $disconnect } from '@feed/db';
import {
  FeedLLMClient,
  MarketContextService,
  MarketDecisionEngine,
} from '@feed/engine';
import { autonomousCoordinator } from '../packages/agents/src/autonomous/AutonomousCoordinator';
import { agentRuntimeManager } from '../packages/agents/src/runtime/AgentRuntimeManager';
import { npcBootstrapService } from '../packages/agents/src/services/npc-bootstrap.service';
import {
  endTrace,
  getActiveTracer,
  installLLMInterceptor,
  setLLMCallCallback,
  startTrace,
  uninstallLLMInterceptor,
  writeTickTrace,
} from '../packages/engine/src/dag-trace';

const marketMode = process.argv.includes('--market');
const ids = process.argv.slice(2).filter((id) => id !== '--market');
if (!ids.length) throw new Error('Pass NPC IDs to audit');
const database = new URL(process.env.DATABASE_URL || '');
if (!['127.0.0.1', 'localhost'].includes(database.hostname)) {
  throw new Error('This audit harness requires an isolated local database');
}
const output = path.resolve('runs', `agent-audit-${Date.now()}`);
mkdirSync(output, { recursive: true });
startTrace(`agent-audit-${Date.now()}`, 0);
installLLMInterceptor();
let calls = 0;
setLLMCallCallback((call) => {
  getActiveTracer()?.recordLLMCall(call);
  appendFileSync(
    path.join(output, 'llm-calls.jsonl'),
    `${JSON.stringify(call)}\n`
  );
  calls++;
});
const outcomes: Array<{
  id: string;
  success: boolean;
  trajectoryId?: string;
  error?: string;
}> = [];
try {
  if (marketMode) {
    getActiveTracer()?.startNode('market-decisions', { ids });
    try {
      const engine = new MarketDecisionEngine(
        FeedLLMClient.forGroq(),
        new MarketContextService()
      );
      const decisions = await engine.generateDecisionsForNPCs(ids);
      writeFileSync(
        path.join(output, 'decisions.json'),
        JSON.stringify(decisions, null, 2)
      );
      for (const decision of decisions)
        outcomes.push({ id: decision.npcId, success: true });
      getActiveTracer()?.endNode('market-decisions', { decisions });
    } catch (error) {
      getActiveTracer()?.failNode('market-decisions', error);
      process.exitCode = 1;
      for (const id of ids)
        outcomes.push({
          id,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
    }
  } else
    for (const id of ids) {
      getActiveTracer()?.startNode(id, { agentId: id });
      try {
        await npcBootstrapService.bootstrapNpc(id);
        const runtime = await agentRuntimeManager.getRuntime(id);
        const result = await autonomousCoordinator.executeAutonomousTick(
          id,
          runtime,
          true,
          true
        );
        outcomes.push({
          id,
          success: result.success,
          trajectoryId: result.trajectoryId,
          ...(result.success ? {} : { error: 'Agent tick returned failure' }),
        });
        if (result.success) getActiveTracer()?.endNode(id, { ...result });
        else {
          getActiveTracer()?.failNode(id, 'Agent tick returned failure');
          process.exitCode = 1;
        }
      } catch (error) {
        getActiveTracer()?.failNode(id, error);
        outcomes.push({
          id,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
        process.exitCode = 1;
      } finally {
        await agentRuntimeManager.clearRuntime(id);
      }
    }
} finally {
  getActiveTracer()?.setGameTickResult({ outcomes, calls });
  const trace = endTrace();
  if (trace) await writeTickTrace(trace);
  uninstallLLMInterceptor();
  writeFileSync(
    path.join(output, 'summary.json'),
    JSON.stringify({ outcomes, calls }, null, 2)
  );
  await $disconnect();
  console.log(JSON.stringify({ output, outcomes, calls }));
}
