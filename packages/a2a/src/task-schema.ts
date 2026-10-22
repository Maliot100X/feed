import type { Task } from '@a2a-js/sdk';
import { z } from 'zod';

export const TASK_STATES = [
  'submitted',
  'working',
  'input-required',
  'completed',
  'canceled',
  'failed',
  'rejected',
  'auth-required',
  'unknown',
] as const;

/**
 * Zod schema for TaskStatus validation
 */
const TaskStatusSchema = z.object({
  state: z.enum(TASK_STATES),
  timestamp: z.string().optional(),
  message: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Zod schema for full Task validation
 * Validates all required properties according to the A2A SDK Task interface
 */
export const TaskSchema = z.object({
  id: z.string(),
  contextId: z.string(),
  kind: z.literal('task'),
  status: TaskStatusSchema,
  artifacts: z.array(z.record(z.string(), z.unknown())).optional(),
  history: z.array(z.record(z.string(), z.unknown())).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export function isValidTask(obj: unknown): obj is Task {
  return TaskSchema.safeParse(obj).success;
}
