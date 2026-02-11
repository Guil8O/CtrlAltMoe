/**
 * Google Gemini adapter — uses the REST generateContent/streamGenerateContent
 */
import {
  type ProviderAdapter,
  type ProviderConfig,
  type ChatRequest,
  type ChatStreamChunk,
  type ChatRequestMessage,
} from './types';
import { getProviderConfig } from './registry';

export class GeminiAdapter implements ProviderAdapter {
  readonly id = 'gemini' as const;
  readonly config: ProviderConfig;

  constructor() {
    this.config = getProviderConfig('gemini');
  }

  async chat(
    request: ChatRequest,
    apiKey: string,
    baseUrl?: string,
  ): Promise<ReadableStream<ChatStreamChunk>> {
    const base = baseUrl || this.config.baseUrl;
    const url = `${base}/v1beta/models/${request.model}:streamGenerateContent?alt=sse&key=${apiKey}`;

    // Extract system instruction
    const systemMsg = request.messages.find(m => m.role === 'system');
    const systemText = systemMsg
      ? (typeof systemMsg.content === 'string' ? systemMsg.content : systemMsg.content.map(p => p.type === 'text' ? p.text : '').join(''))
      : undefined;

    // Convert messages
    const contents = request.messages
      .filter(m => m.role !== 'system')
      .map(m => this.convertMessage(m));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: request.temperature ?? 0.7,
        maxOutputTokens: request.max_tokens ?? 2048,
      },
    };
    if (systemText) {
      body.systemInstruction = { parts: [{ text: systemText }] };
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`[gemini] ${resp.status}: ${err}`);
    }

    return this.parseSSE(resp);
  }

  private convertMessage(msg: ChatRequestMessage) {
    const role = msg.role === 'assistant' ? 'model' : 'user';

    if (typeof msg.content === 'string') {
      return { role, parts: [{ text: msg.content }] };
    }

    const parts = msg.content.map(part => {
      if (part.type === 'text') return { text: part.text };
      if (part.type === 'image_url') {
        const url = part.image_url.url;
        if (url.startsWith('data:')) {
          const match = url.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            return {
              inlineData: { mimeType: match[1], data: match[2] },
            };
          }
        }
        return { text: `[Image: ${url}]` };
      }
      return { text: '' };
    });

    return { role, parts };
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
            const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const finishReason = json.candidates?.[0]?.finishReason;
            if (text) controller.enqueue({ content: text, done: false });
            if (finishReason === 'STOP') {
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
