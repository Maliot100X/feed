/**
 * Actions Provider
 *
 * Lists available actions for the agent to call during multi-step execution.
 */

import { createActionsProvider } from '../../../shared/actions-provider';

export const actionsProvider = createActionsProvider(
  'Available actions the agent can execute'
);
