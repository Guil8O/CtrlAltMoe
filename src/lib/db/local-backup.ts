/**
 * Local Storage Backup — persistent layer for settings & data
 *
 * Plasma WebEngineView may clear IndexedDB on restart.
 * This module mirrors critical data to localStorage (more persistent)
 * and optionally to a user-chosen file path via File System Access API.
 */

import { db, type AppSettings, type CharacterRecord, type ChatMessage, type RollingSummary, DEFAULT_SETTINGS, SCHEMA_VERSION } from './schema';

const LS_KEY_SETTINGS = 'ctrlaltmoe_settings';
const LS_KEY_CHARACTERS = 'ctrlaltmoe_characters';
const LS_KEY_MESSAGES = 'ctrlaltmoe_messages';
const LS_KEY_SUMMARIES = 'ctrlaltmoe_summaries';
const LS_KEY_FULL_BACKUP = 'ctrlaltmoe_backup';

/* ───── Save to localStorage ───── */

export function saveSettingsToLS(settings: AppSettings): void {
  try {
    localStorage.setItem(LS_KEY_SETTINGS, JSON.stringify(settings));
  } catch { /* quota exceeded — silently fail */ }
}

export function saveCharactersToLS(characters: CharacterRecord[]): void {
  try {
    localStorage.setItem(LS_KEY_CHARACTERS, JSON.stringify(characters));
  } catch { /* quota exceeded */ }
}

export function saveMessagesToLS(characterId: string, messages: ChatMessage[]): void {
  try {
    // Store per-character messages map
    const existing = JSON.parse(localStorage.getItem(LS_KEY_MESSAGES) || '{}');
    existing[characterId] = messages;
    localStorage.setItem(LS_KEY_MESSAGES, JSON.stringify(existing));
  } catch { /* quota exceeded */ }
}

export function saveSummaryToLS(summary: RollingSummary): void {
  try {
    const existing = JSON.parse(localStorage.getItem(LS_KEY_SUMMARIES) || '{}');
    existing[summary.characterId] = summary;
    localStorage.setItem(LS_KEY_SUMMARIES, JSON.stringify(existing));
  } catch { /* quota exceeded */ }
}

/* ───── Load from localStorage ───── */

export function loadSettingsFromLS(): AppSettings | null {
  try {
    const raw = localStorage.getItem(LS_KEY_SETTINGS);
    if (raw) return JSON.parse(raw);
  } catch { /* parse error */ }
  return null;
}

export function loadCharactersFromLS(): CharacterRecord[] | null {
  try {
    const raw = localStorage.getItem(LS_KEY_CHARACTERS);
    if (raw) return JSON.parse(raw);
  } catch { /* parse error */ }
  return null;
}

export function loadMessagesFromLS(characterId: string): ChatMessage[] | null {
  try {
    const raw = localStorage.getItem(LS_KEY_MESSAGES);
    if (raw) {
      const map = JSON.parse(raw);
      if (map[characterId]) return map[characterId];
    }
  } catch { /* parse error */ }
  return null;
}

export function loadSummaryFromLS(characterId: string): RollingSummary | null {
  try {
    const raw = localStorage.getItem(LS_KEY_SUMMARIES);
    if (raw) {
      const map = JSON.parse(raw);
      if (map[characterId]) return map[characterId];
    }
  } catch { /* parse error */ }
  return null;
}

/* ───── Full backup (for manual file save/load) ───── */

export async function createFullBackup(): Promise<string> {
  const data = {
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    characters: await db.characters.toArray(),
    messages: await db.messages.toArray(),
    dailySummaries: await db.dailySummaries.toArray(),
    rollingSummaries: await db.rollingSummaries.toArray(),
    settings: await db.settings.toArray(),
  };
  return JSON.stringify(data, null, 2);
}

export async function restoreFullBackup(jsonStr: string): Promise<void> {
  const data = JSON.parse(jsonStr);
  if (data.characters) await db.characters.bulkPut(data.characters);
  if (data.messages) await db.messages.bulkPut(data.messages);
  if (data.dailySummaries) await db.dailySummaries.bulkPut(data.dailySummaries);
  if (data.rollingSummaries) await db.rollingSummaries.bulkPut(data.rollingSummaries);
  if (data.settings) await db.settings.bulkPut(data.settings);
}

/* ───── Restore IndexedDB from localStorage if IDB is empty ───── */

export async function restoreFromLSIfNeeded(): Promise<boolean> {
  // Check if IndexedDB has data
  const idbSettings = await db.settings.get('global');
  const idbChars = await db.characters.count();

  if (idbSettings && idbChars > 0) {
    // IDB has data, no restore needed
    return false;
  }

  let restored = false;

  // Restore settings from LS
  if (!idbSettings) {
    const lsSettings = loadSettingsFromLS();
    if (lsSettings) {
      await db.settings.put(lsSettings);
      restored = true;
    }
  }

  // Restore characters from LS
  if (idbChars === 0) {
    const lsChars = loadCharactersFromLS();
    if (lsChars && lsChars.length > 0) {
      await db.characters.bulkPut(lsChars);
      restored = true;

      // Restore messages for each character
      for (const char of lsChars) {
        const msgs = loadMessagesFromLS(char.id);
        if (msgs && msgs.length > 0) {
          await db.messages.bulkPut(msgs);
        }
        const summary = loadSummaryFromLS(char.id);
        if (summary) {
          await db.rollingSummaries.put(summary);
        }
      }
    }
  }

  if (restored) {
    console.log('[Ctrl+Alt+Moe] Restored data from localStorage backup');
  }

  return restored;
}

/* ───── Auto-save full snapshot to localStorage ───── */

export async function autoSaveToLS(): Promise<void> {
  try {
    const settings = await db.settings.get('global');
    if (settings) saveSettingsToLS(settings);

    const chars = await db.characters.toArray();
    saveCharactersToLS(chars);

    // Save messages for each active (non-archived) character
    for (const char of chars.filter(c => !c.archived)) {
      const msgs = await db.messages
        .where('[characterId+createdAt]')
        .between([char.id, 0], [char.id, Infinity])
        .toArray();
      saveMessagesToLS(char.id, msgs);
    }

    const summaries = await db.rollingSummaries.toArray();
    for (const s of summaries) {
      saveSummaryToLS(s);
    }
  } catch (err) {
    console.warn('[Ctrl+Alt+Moe] Auto-save to localStorage failed:', err);
  }
}
