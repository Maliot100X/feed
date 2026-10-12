/**
 * Feed Plugin Service Exports
 *
 * Re-exports autonomous services that use the Feed A2A plugin
 */

export {
  disconnectAgentA2AClient,
  enhanceRuntimeWithFeed,
  hasActiveA2AConnection,
  initializeAgentA2AClient,
} from './integration';
