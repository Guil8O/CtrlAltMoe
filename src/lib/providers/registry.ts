/**
 * Provider registry — hardcoded configs for each provider
 */
import {
  type ProviderConfig,
  type ProviderId,
  type ModelCapabilities,
  NO_CAPABILITIES,
  VISION_CAPABILITIES,
} from './types';

/* ───── Helpers ───── */
const vision = (extra?: Partial<ModelCapabilities>): ModelCapabilities => ({
  ...VISION_CAPABILITIES,
  ...extra,
});

const textOnly = (extra?: Partial<ModelCapabilities>): ModelCapabilities => ({
  ...NO_CAPABILITIES,
  ...extra,
});

const visionWithPdf = (extra?: Partial<ModelCapabilities>): ModelCapabilities => ({
  ...VISION_CAPABILITIES,
  supportsFileInput: true,
  fileInputTypes: 'pdf_only',
  fileInputMode: 'base64_inline',
  ...extra,
});

const geminiCaps: ModelCapabilities = {
  supportsImageInput: true,
  imageInputMode: 'base64_inline',
  supportsFileInput: true,
  fileInputTypes: 'media_any',
  fileInputMode: 'base64_inline',
  supportsWebSearch: false,
  supportsStreaming: true,
};

/* ───── Provider Configs ───── */

export const PROVIDER_CONFIGS: Record<ProviderId, ProviderConfig> = {
  chatgpt: {
    id: 'chatgpt',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    requiresApiKey: true,
    defaultModel: 'gpt-4o-mini',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', capabilities: vision({ supportsFileInput: true, fileInputTypes: 'pdf_only', fileInputMode: 'url' }) },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', capabilities: vision() },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', capabilities: vision() },
      { id: 'gpt-4.1', name: 'GPT-4.1', capabilities: vision() },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', capabilities: vision() },
      { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', capabilities: vision() },
      { id: 'o3-mini', name: 'o3-mini', capabilities: textOnly() },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', capabilities: textOnly() },
    ],
  },

  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    requiresApiKey: true,
    defaultModel: 'gemini-2.0-flash',
    models: [
      { id: 'gemini-2.5-pro-preview-05-06', name: 'Gemini 2.5 Pro', capabilities: geminiCaps },
      { id: 'gemini-2.5-flash-preview-05-20', name: 'Gemini 2.5 Flash', capabilities: geminiCaps },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', capabilities: geminiCaps },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', capabilities: geminiCaps },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', capabilities: geminiCaps },
    ],
  },

  claude: {
    id: 'claude',
    name: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    requiresApiKey: true,
    defaultModel: 'claude-sonnet-4-20250514',
    models: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', capabilities: visionWithPdf() },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', capabilities: visionWithPdf() },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', capabilities: visionWithPdf() },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', capabilities: visionWithPdf() },
    ],
  },

  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    requiresApiKey: true,
    defaultModel: 'deepseek-chat',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat (V3)', capabilities: textOnly() },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner (R1)', capabilities: textOnly() },
    ],
  },

  kimi: {
    id: 'kimi',
    name: 'Moonshot Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    requiresApiKey: true,
    defaultModel: 'moonshot-v1-auto',
    models: [
      { id: 'moonshot-v1-auto', name: 'Moonshot v1 Auto', capabilities: vision({ supportsFileInput: true, fileInputTypes: 'pdf_only', fileInputMode: 'file_id' }) },
      { id: 'moonshot-v1-8k', name: 'Moonshot v1 8K', capabilities: textOnly() },
      { id: 'moonshot-v1-32k', name: 'Moonshot v1 32K', capabilities: textOnly() },
      { id: 'moonshot-v1-128k', name: 'Moonshot v1 128K', capabilities: textOnly() },
    ],
  },

  ollama: {
    id: 'ollama',
    name: 'Ollama (Local)',
    baseUrl: 'http://localhost:11434',
    requiresApiKey: false,
    defaultModel: 'llama3',
    models: [
      { id: 'llama3', name: 'Llama 3', capabilities: textOnly() },
      { id: 'llama3.1', name: 'Llama 3.1', capabilities: textOnly() },
      { id: 'mistral', name: 'Mistral', capabilities: textOnly() },
      { id: 'gemma2', name: 'Gemma 2', capabilities: textOnly() },
      { id: 'llava', name: 'LLaVA (Vision)', capabilities: vision() },
      { id: 'bakllava', name: 'BakLLaVA (Vision)', capabilities: vision() },
    ],
  },

  custom: {
    id: 'custom',
    name: 'Custom (OpenAI-compatible)',
    baseUrl: '',
    requiresApiKey: true,
    defaultModel: 'default',
    models: [
      { id: 'default', name: 'Default Model', capabilities: textOnly() },
    ],
  },
};

export function getProviderConfig(id: ProviderId): ProviderConfig {
  return PROVIDER_CONFIGS[id];
}

export function getModelCapabilities(providerId: ProviderId, modelId: string): ModelCapabilities {
  const cfg = PROVIDER_CONFIGS[providerId];
  const model = cfg.models.find(m => m.id === modelId);
  return model?.capabilities ?? NO_CAPABILITIES;
}
