import type { AgentRuntime, ModelTypeName } from '@elizaos/core';
import { ModelType } from '@elizaos/core';
import { resolveGroqModel } from '../llm/direct-groq';

/** Label the selected handler, without claiming an unobserved vendor model ID. */
export function describeRuntimeModel(
  runtime: AgentRuntime,
  modelType: ModelTypeName
): string {
  const selected = runtime.models.get(modelType)?.[0];
  if (!selected)
    throw new Error(`No model handler registered for ${modelType}`);
  if (selected.provider === 'groq') {
    return resolveGroqModel({
      runtime,
      modelSize: modelType === ModelType.TEXT_SMALL ? 'small' : 'large',
    });
  }
  return `${selected.provider}/${modelType}`;
}
