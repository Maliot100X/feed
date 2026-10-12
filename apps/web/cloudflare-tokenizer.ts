import {
  getEncodingNameForModel,
  Tiktoken,
  type TiktokenEncoding,
  type TiktokenModel,
} from 'js-tiktoken/lite';
import cl100kBase from 'js-tiktoken/ranks/cl100k_base';
import o200kBase from 'js-tiktoken/ranks/o200k_base';

export type { TiktokenEncoding, TiktokenModel };
export { getEncodingNameForModel, Tiktoken };

// Cloudflare runs Surplus GPT-4o; legacy OpenAI code also shares these ranks.
// Keep the registry out of the Worker, where unused dictionaries cost upload size.
export function getEncoding(
  name: TiktokenEncoding,
  extendSpecialTokens?: Record<string, number>
): Tiktoken {
  const ranks =
    name === 'o200k_base'
      ? o200kBase
      : name === 'cl100k_base'
        ? cl100kBase
        : undefined;
  if (!ranks) throw new Error(`Unsupported Cloudflare token encoding: ${name}`);
  return new Tiktoken(ranks, extendSpecialTokens);
}

export function encodingForModel(
  model: TiktokenModel,
  extendSpecialTokens?: Record<string, number>
): Tiktoken {
  return getEncoding(getEncodingNameForModel(model), extendSpecialTokens);
}
