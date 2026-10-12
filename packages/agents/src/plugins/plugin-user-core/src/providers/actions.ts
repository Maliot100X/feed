/**
 * Coordinator Actions Provider
 *
 * Lists available actions for the coordinator to call during multi-step execution.
 */

import { createActionsProvider } from '../../../shared/actions-provider';

export const coordinatorActionsProvider = createActionsProvider(
  'Available actions the coordinator can execute'
);
