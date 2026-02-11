/**
 * OpenAI-compatible adapter (used for chatgpt, deepseek, kimi, custom, ollama)
 */
import {
  type ProviderAdapter,
  type ProviderId,
  type ProviderConfig,
  type ChatRequest,
  type ChatStreamChunk,
} from './types';
import { getProviderConfig } from './registry';

export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly id: ProviderId;
  readonly config: ProviderConfig;

  constructor(id: ProviderId) {
    this.id = id;
    this.config = getProviderConfig(id);
  }

  async chat(
    request: ChatRequest,
    apiKey: string,
    baseUrl?: string,
  ): Promise<ReadableStream<ChatStreamChunk>> {
    const base = baseUrl || this.config.baseUrl;
    let url: string;

    // Ollama uses /api/chat
    if (this.id === 'ollama') {
      url = `${base}/api/chat`;
    } else {
      url = `${base}/chat/completions`;
      if (!url.includes('/v1/') && !url.endsWith('/v1')) {
        // e.g. deepseek base already includes path
        if (!url.includes('chat/completions')) {
          url = `${base}/v1/chat/completions`;
        }
      }
      // fix if base already has /v1
      if (base.endsWith('/v1')) {
        url = `${base}/chat/completions`;
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    if (this.id === 'ollama') {
      return this.chatOllama(url, request, headers);
    }

    const body = {
      model: request.model,
      messages: request.messages,
      stream: true,
      max_tokens: request.max_tokens ?? 2048,
      temperature: request.temperature ?? 0.7,
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`[${this.id}] ${resp.status}: ${err}`);
    }

    return this.parseSSEStream(resp);
  }

  private async chatOllama(
    url: string,
    request: ChatRequest,
    headers: Record<string, string>,
  ): Promise<ReadableStream<ChatStreamChunk>> {
    const body = {
      model: request.model,
      messages: request.messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : m.content.map(p => {
          if (p.type === 'text') return p.text;
          return '';
        }).join(''),
        ...(typeof m.content !== 'string' && m.content.some(p => p.type === 'image_url')
          ? { images: m.content.filter(p => p.type === 'image_url').map(p => {
              if (p.type === 'image_url') {
                const url = p.image_url.url;
                if (url.startsWith('data:')) {
                  return url.split(',')[1]; // base64
                }
                return url;
              }
              return '';
            })
          }
          : {}),
      })),
      stream: true,
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`[ollama] ${resp.status}: ${err}`);
    }

    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();

    return new ReadableStream<ChatStreamChunk>({
      async pull(controller) {
        const { value, done } = await reader.read();
        if (done) {
          controller.enqueue({ content: '', done: true });
          controller.close();
          return;
        }
        const text = decoder.decode(value, { stream: true });
        const lines = text.split('\n').filter(l => l.trim());
        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            const content = json.message?.content || '';
            controller.enqueue({ content, done: json.done || false });
            if (json.done) {
              controller.close();
              return;
            }
          } catch { /* skip */ }
        }
      },
    });
  }

  private parseSSEStream(resp: Response): ReadableStream<ChatStreamChunk> {
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    return new ReadableStream<ChatStreamChunk>({
      async pull(controller) {
        const { value, done } = await reader.read();
        if (done) {
          controller.enqueue({ content: '', done: true });
          controller.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            controller.enqueue({ content: '', done: true });
            controller.close();
            return;
          }
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta;
            const content = delta?.content || '';
            const finishReason = json.choices?.[0]?.finish_reason;
            if (content) {
              controller.enqueue({ content, done: false });
            }
            if (finishReason) {
              controller.enqueue({ content: '', done: true });
              controller.close();
              return;
            }
          } catch { /* skip malformed */ }
        }
      },
    });
  }
}
