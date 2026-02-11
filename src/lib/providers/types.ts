/**
 * Provider abstraction types
 */

export type ProviderId = 'chatgpt' | 'gemini' | 'claude' | 'deepseek' | 'kimi' | 'ollama' | 'custom';

export type ImageInputMode = 'none' | 'base64_inline' | 'url' | 'file_id';
export type FileInputType = 'none' | 'pdf_only' | 'media_any' | 'text_only';
export type FileInputMode = 'none' | 'base64_inline' | 'url' | 'file_id' | 'files_api';

export interface ModelCapabilities {
  supportsImageInput: boolean;
  imageInputMode: ImageInputMode;
  supportsFileInput: boolean;
  fileInputTypes: FileInputType;
  fileInputMode: FileInputMode;
  supportsWebSearch: boolean;
  supportsStreaming: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  capabilities: ModelCapabilities;
}

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  baseUrl: string;
  requiresApiKey: boolean;
  models: ModelInfo[];
  defaultModel: string;
}

export interface ChatRequestMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: string } }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }; // claude

export interface ChatRequest {
  messages: ChatRequestMessage[];
  model: string;
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
}

export interface ChatStreamChunk {
  content: string;
  done: boolean;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly config: ProviderConfig;

  /** Send a chat request and return a ReadableStream of text chunks */
  chat(
    request: ChatRequest,
    apiKey: string,
    baseUrl?: string,
  ): Promise<ReadableStream<ChatStreamChunk>>;

  /** Probe whether image input is supported at runtime */
  probeImageSupport?(apiKey: string, baseUrl?: string): Promise<boolean>;
}

/* ───── Default capabilities (no support) ───── */
export const NO_CAPABILITIES: ModelCapabilities = {
  supportsImageInput: false,
  imageInputMode: 'none',
  supportsFileInput: false,
  fileInputTypes: 'none',
  fileInputMode: 'none',
  supportsWebSearch: false,
  supportsStreaming: true,
};

export const VISION_CAPABILITIES: ModelCapabilities = {
  supportsImageInput: true,
  imageInputMode: 'base64_inline',
  supportsFileInput: false,
  fileInputTypes: 'none',
  fileInputMode: 'none',
  supportsWebSearch: false,
  supportsStreaming: true,
};
