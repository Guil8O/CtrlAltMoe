/**
 * Chat engine — orchestrates LLM calls, meta parsing, emotion/gesture triggers,
 * i18n keyword-based motion matching, and hobby keyword extraction.
 */
import { useAppStore } from '@/store/app-store';
import { getAdapter, type ProviderId, type ChatRequestMessage, type ContentPart } from '@/lib/providers';
import { type ChatMessage, type ResponseMeta } from '@/lib/db/schema';
import { matchMotionFromText, extractHobbyKeywords, type SupportedLang } from './motion-matcher';

/* ───── System prompt builder ───── */

function buildSystemPrompt(
  personaText: string,
  rollingSummary: string | null,
  recentMessages: ChatMessage[],
): string {
  const parts: string[] = [];

  parts.push(`You are a character in a conversation. Respond naturally in-character.

## Your Persona
${personaText || 'You are a friendly, kind, and curious AI companion.'}

## Response Format
You MUST respond with valid JSON containing exactly two fields:
1. "text": Your response text (natural language, can include markdown)
2. "meta": An object with:
   - "emotion": { "happy": 0-1, "angry": 0-1, "sad": 0-1, "surprised": 0-1 }
   - "gesture": one of: "none", "nod", "shake", "thinking", "clap", "cheer", "shrug", "point", "surprise", "wave", "bow"
   - "affection_delta": -2 to +2 (how much you like the user's message)
   - "user_mood_estimate": one of: "calm", "stressed", "excited", "tired", "angry", "sad"

Example response:
{"text":"Hello! How are you today? 😊","meta":{"emotion":{"happy":0.7,"angry":0,"sad":0,"surprised":0},"gesture":"nod","affection_delta":1,"user_mood_estimate":"calm"}}

IMPORTANT: Your ENTIRE response must be valid JSON. No text before or after the JSON.`);

  if (rollingSummary) {
    parts.push(`\n## Conversation Summary\n${rollingSummary}`);
  }

  return parts.join('\n');
}

/* ───── Parse meta from response ───── */

interface ParsedResponse {
  text: string;
  meta: ResponseMeta;
}

function parseResponse(raw: string): ParsedResponse {
  // Try to parse as JSON
  try {
    // Handle potential markdown code fences
    let cleaned = raw.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    const parsed = JSON.parse(cleaned);
    if (parsed.text && parsed.meta) {
      return {
        text: parsed.text,
        meta: {
          emotion: parsed.meta.emotion,
          gesture: parsed.meta.gesture || 'none',
          affectionDelta: parsed.meta.affection_delta || 0,
          userMoodEstimate: parsed.meta.user_mood_estimate || 'calm',
        },
      };
    }
  } catch {
    // If JSON parse fails, try to extract JSON from the text
    const jsonMatch = raw.match(/\{[\s\S]*"text"\s*:\s*"[\s\S]*?"[\s\S]*"meta"\s*:\s*\{[\s\S]*\}\s*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          text: parsed.text,
          meta: {
            emotion: parsed.meta?.emotion,
            gesture: parsed.meta?.gesture || 'none',
            affectionDelta: parsed.meta?.affection_delta || 0,
            userMoodEstimate: parsed.meta?.user_mood_estimate || 'calm',
          },
        };
      } catch { /* fallthrough */ }
    }
  }

  // Fallback: treat entire response as text
  return {
    text: raw,
    meta: {
      emotion: { happy: 0.2, angry: 0, sad: 0, surprised: 0 },
      gesture: 'none',
      affectionDelta: 0,
      userMoodEstimate: 'calm',
    },
  };
}

/* ───── Main chat function ───── */

export interface ChatOptions {
  imageDataUrls?: string[];
  screenCapture?: string;
}

export async function sendChat(userText: string, options?: ChatOptions): Promise<void> {
  const store = useAppStore.getState();
  const { settings, activeCharacterId, messages, rollingSummary, viewer } = store;

  if (!activeCharacterId) throw new Error('No character selected');

  const char = store.characters.find(c => c.id === activeCharacterId);
  if (!char) throw new Error('Character not found');

  // Reset idle timer when user sends a message
  if (viewer.model?.animationManager) {
    viewer.model.animationManager.resetIdleTimer();
  }

  // Build persona
  const persona = char.personaText || `Name: ${char.name}
Speaking style: ${char.speakingStyle}
Personality: ${char.personality}
${char.likes ? `Likes: ${char.likes}` : ''}
${char.dislikes ? `Dislikes: ${char.dislikes}` : ''}`;

  // Build messages for API
  const systemPrompt = buildSystemPrompt(
    persona,
    rollingSummary?.content || null,
    messages.slice(-12),
  );

  // Add user message to DB
  const userContent: string | ContentPart[] = options?.imageDataUrls?.length || options?.screenCapture
    ? buildMultimodalContent(userText, options)
    : userText;

  await store.addMessage({
    characterId: activeCharacterId,
    role: 'user',
    content: userText,
    attachments: options?.imageDataUrls?.map((url, i) => ({
      type: 'image' as const,
      name: `image-${i}.png`,
      mimeType: 'image/png',
      size: 0,
      dataUrl: url,
    })),
  });

  // Build request messages
  const apiMessages: ChatRequestMessage[] = [
    { role: 'system', content: systemPrompt },
  ];

  // Add recent messages (last 12)
  const recentMsgs = [...store.messages].slice(-12);
  for (const m of recentMsgs) {
    if (m.role === 'system') continue;
    apiMessages.push({ role: m.role, content: m.content });
  }

  // Add current user message (potentially with images)
  if (typeof userContent !== 'string') {
    apiMessages.push({ role: 'user', content: userContent });
  } else {
    apiMessages.push({ role: 'user', content: userContent });
  }

  // Stream response
  store.setStreaming(true);
  store.setStreamingContent('');

  try {
    const adapter = getAdapter(settings.provider as ProviderId);
    const baseUrl = settings.baseUrl || undefined;
    const stream = await adapter.chat(
      {
        messages: apiMessages,
        model: settings.model,
        stream: true,
        max_tokens: 2048,
        temperature: 0.7,
      },
      settings.apiKey,
      baseUrl,
    );

    let fullResponse = '';
    const reader = stream.getReader();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value.content) {
        fullResponse += value.content;
        store.setStreamingContent(fullResponse);
      }
      if (value.done) break;
    }

    // Parse the response
    const parsed = parseResponse(fullResponse);

    // Save assistant message
    await store.addMessage({
      characterId: activeCharacterId,
      role: 'assistant',
      content: parsed.text,
      meta: parsed.meta,
    });

    // Apply emotion to VRM
    if (parsed.meta.emotion && viewer.model?.emoteController) {
      viewer.model.emoteController.setEmotion(parsed.meta.emotion);

      // Switch idle animation to match dominant emotion
      const emKeys = Object.entries(parsed.meta.emotion);
      const dominant = emKeys.reduce((a, b) => (b[1] > a[1] ? b : a), ['neutral', 0]);
      if (dominant[1] > 0.3) {
        viewer.model.setEmotionIdle(dominant[0] as 'happy' | 'angry' | 'sad' | 'surprised').catch(() => {});
      }
    }

    // Apply gesture (now async — loads FBX motions)
    if (parsed.meta.gesture && parsed.meta.gesture !== 'none' && viewer.model) {
      viewer.model.playGesture(parsed.meta.gesture as any).catch(() => {});
    }

    // i18n keyword-based motion matching
    // If the gesture was 'none' or neutral, try to detect an emotion-driven motion
    if (viewer.model?.animationManager) {
      const lang = (settings.language ?? 'en') as SupportedLang;
      const dominantEmotion = (() => {
        if (!parsed.meta.emotion) return 'neutral';
        const entries = Object.entries(parsed.meta.emotion);
        const best = entries.reduce((a, b) => (b[1] > a[1] ? b : a), ['neutral', 0]);
        return best[1] > 0.3 ? best[0] : 'neutral';
      })();

      // Only trigger keyword motion if no gesture was applied
      if (!parsed.meta.gesture || parsed.meta.gesture === 'none') {
        const keywordMotionId = await matchMotionFromText(
          userText,
          parsed.text,
          dominantEmotion as string,
          lang,
        );
        if (keywordMotionId) {
          viewer.model.animationManager.playMotionWithFallback(keywordMotionId).catch(() => {});
        }
      }

      // Update emotion for hobby weighting
      viewer.model.animationManager.setCurrentEmotion(dominantEmotion as string);

      // Extract hobby keywords from conversation and pass to animation manager
      const hobbyKw = extractHobbyKeywords(`${userText} ${parsed.text}`);
      if (hobbyKw.length > 0) {
        viewer.model.animationManager.setHobbyKeywords(hobbyKw);
      }
    }

    // Update affection
    if (parsed.meta.affectionDelta) {
      const newAffection = Math.max(0, Math.min(100, char.affection + parsed.meta.affectionDelta));
      await store.updateCharacter(activeCharacterId, {
        affection: newAffection,
        emotionState: parsed.meta.emotion || char.emotionState,
      });
    }

  } catch (err) {
    console.error('Chat error:', err);
    await store.addMessage({
      characterId: activeCharacterId,
      role: 'assistant',
      content: `⚠️ Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
    });
  } finally {
    store.setStreaming(false);
    store.setStreamingContent('');
  }
}

function buildMultimodalContent(text: string, options: ChatOptions): ContentPart[] {
  const parts: ContentPart[] = [];

  if (text) {
    parts.push({ type: 'text', text });
  }

  if (options.screenCapture) {
    parts.push({
      type: 'image_url',
      image_url: { url: options.screenCapture, detail: 'low' },
    });
  }

  if (options.imageDataUrls) {
    for (const url of options.imageDataUrls) {
      parts.push({
        type: 'image_url',
        image_url: { url, detail: 'auto' },
      });
    }
  }

  return parts;
}

/* ───── Summary Engine ───── */

export async function generateRollingSummary(): Promise<void> {
  const store = useAppStore.getState();
  const { settings, activeCharacterId, messages } = store;

  if (!activeCharacterId || messages.length < 8) return;

  const char = store.characters.find(c => c.id === activeCharacterId);
  if (!char) return;

  const summaryPrompt = `Summarize the following conversation between a user and "${char.name}". 
Focus on: key topics, emotional moments, relationship changes, and any important facts mentioned.
Keep it concise (max 200 words). Output plain text summary only.

Conversation:
${messages.slice(-30).map(m => `${m.role}: ${m.content}`).join('\n')}`;

  try {
    const adapter = getAdapter(settings.provider as ProviderId);
    const stream = await adapter.chat(
      {
        messages: [{ role: 'user', content: summaryPrompt }],
        model: settings.model,
        stream: true,
        max_tokens: 500,
        temperature: 0.3,
      },
      settings.apiKey,
      settings.baseUrl || undefined,
    );

    let summary = '';
    const reader = stream.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      summary += value.content;
      if (value.done) break;
    }

    await store.saveRollingSummary(activeCharacterId, summary.trim());
  } catch (err) {
    console.error('Summary generation error:', err);
  }
}

/* ───── Retention cleanup ───── */

export async function runRetentionCleanup(): Promise<void> {
  const store = useAppStore.getState();
  const retentionMs = store.settings.retentionDays * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - retentionMs;

  const { db } = await import('@/lib/db/schema');

  // Delete old messages
  await db.messages.where('createdAt').below(cutoff).delete();

  // Delete old daily summaries
  await db.dailySummaries.where('createdAt').below(cutoff).delete();
}
