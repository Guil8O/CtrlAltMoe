/**
 * Claude (Anthropic) adapter
 */
import {
  type ProviderAdapter,
  type ProviderConfig,
  type ChatRequest,
  type ChatStreamChunk,
  type ChatRequestMessage,
} from './types';
import { getProviderConfig } from './registry';

export class ClaudeAdapter implements ProviderAdapter {
  readonly id = 'claude' as const;
  readonly config: ProviderConfig;

  constructor() {
    this.config = getProviderConfig('claude');
  }

  async chat(
    request: ChatRequest,
    apiKey: string,
    baseUrl?: string,
  ): Promise<ReadableStream<ChatStreamChunk>> {
    const base = baseUrl || this.config.baseUrl;
    const url = `${base}/messages`;

    // Extract system message
    const systemMsg = request.messages.find(m => m.role === 'system');
    const systemText = systemMsg
      ? (typeof systemMsg.content === 'string' ? systemMsg.content : systemMsg.content.map(p => p.type === 'text' ? p.text : '').join(''))
      : undefined;

    // Convert messages (skip system)
    const messages = request.messages
      .filter(m => m.role !== 'system')
      .map(m => this.convertMessage(m));

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      max_tokens: request.max_tokens ?? 2048,
      stream: true,
    };
    if (systemText) {
      body.system = systemText;
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`[claude] ${resp.status}: ${err}`);
    }

    return this.parseSSE(resp);
  }

  private convertMessage(msg: ChatRequestMessage) {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: msg.content };
    }

    const content = msg.content.map(part => {
      if (part.type === 'text') return { type: 'text', text: part.text };
      if (part.type === 'image_url') {
        const url = part.image_url.url;
        if (url.startsWith('data:')) {
          const match = url.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            return {
              type: 'image',
              source: { type: 'base64', media_type: match[1], data: match[2] },
            };
          }
        }
        return {
          type: 'image',
          source: { type: 'url', url },
        };
      }
      return { type: 'text', text: '' };
    });

    return { role: msg.role, content };
  }

  private parseSSE(resp: Response): ReadableStream<ChatStreamChunk> {
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
          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          try {
            const json = JSON.parse(data);
            if (json.type === 'content_block_delta') {
              const text = json.delta?.text || '';
              if (text) controller.enqueue({ content: text, done: false });
            } else if (json.type === 'message_stop') {
              controller.enqueue({ content: '', done: true });
              controller.close();
              return;
            }
          } catch { /* skip */ }
        }
      },
    });
  }
}
