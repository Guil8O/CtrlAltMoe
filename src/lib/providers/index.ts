/**
 * Provider manager — factory + singleton access
 */
import { type ProviderAdapter, type ProviderId } from './types';
import { OpenAICompatibleAdapter } from './openai-adapter';
import { ClaudeAdapter } from './claude-adapter';
import { GeminiAdapter } from './gemini-adapter';

const adapters: Partial<Record<ProviderId, ProviderAdapter>> = {};

export function getAdapter(id: ProviderId): ProviderAdapter {
  if (!adapters[id]) {
    switch (id) {
      case 'claude':
        adapters[id] = new ClaudeAdapter();
        break;
      case 'gemini':
        adapters[id] = new GeminiAdapter();
        break;
      case 'chatgpt':
      case 'deepseek':
      case 'kimi':
      case 'ollama':
      case 'custom':
        adapters[id] = new OpenAICompatibleAdapter(id);
        break;
    }
  }
  return adapters[id]!;
}

export { PROVIDER_CONFIGS, getProviderConfig, getModelCapabilities } from './registry';
export type { ProviderId, ProviderAdapter, ModelCapabilities, ChatRequest, ChatStreamChunk, ChatRequestMessage, ContentPart } from './types';
