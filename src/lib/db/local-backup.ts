/**
 * Local Storage Persistence — THE primary reliable storage layer.
 *
 * Problem:
 *   - KDE Plasma's WebEngineView (QtWebEngine) often WIPES IndexedDB on restart.
 *   - File System Access API (showDirectoryPicker) does NOT work in QtWebEngine.
 *   - Regular browser (Chrome/Firefox) keeps both IDB and localStorage fine.
 *
 * Solution:
 *   - localStorage is the most reliable storage in both contexts.
 *   - We save ALL data to localStorage on every mutation.
 *   - On load, if IndexedDB is empty, we restore from localStorage.
 *   - Export/Import uses JSON file download/upload (works everywhere).
 *
 * localStorage key layout:
 *   ctrlaltmoe_settings    → AppSettings JSON
 *   ctrlaltmoe_characters  → CharacterRecord[] JSON
 *   ctrlaltmoe_msgs_{id}   → ChatMessage[] per character
 *   ctrlaltmoe_summary_{id}→ RollingSummary per character
 *   ctrlaltmoe_daily       → DailySummary[] JSON
 *   ctrlaltmoe_lastSave    → ISO timestamp of last save
 */

import {
  db,
  type AppSettings,
  type CharacterRecord,
  type ChatMessage,
  type RollingSummary,
  type DailySummary,
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
} from './schema';

/* ═══════════════════════════════════════════
   Keys
   ═══════════════════════════════════════════ */

const K = {
  settings: 'ctrlaltmoe_settings',
  characters: 'ctrlaltmoe_characters',
  daily: 'ctrlaltmoe_daily',
  lastSave: 'ctrlaltmoe_lastSave',
  msgPrefix: 'ctrlaltmoe_msgs_',
  sumPrefix: 'ctrlaltmoe_summary_',
} as const;

/* ═══════════════════════════════════════════
   Helpers — safe JSON read/write
   ═══════════════════════════════════════════ */

function lsSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('[LS] Write failed (quota?):', key, e);
  }
}

function lsGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/* ═══════════════════════════════════════════
   Save individual data types
   ═══════════════════════════════════════════ */

export function saveSettingsToLS(settings: AppSettings): void {
  lsSet(K.settings, settings);
}

export function saveCharactersToLS(characters: CharacterRecord[]): void {
  lsSet(K.characters, characters);
}

export function saveMessagesToLS(characterId: string, messages: ChatMessage[]): void {
  lsSet(K.msgPrefix + characterId, messages);
}

export function saveSummaryToLS(summary: RollingSummary): void {
  lsSet(K.sumPrefix + summary.characterId, summary);
}

/* ═══════════════════════════════════════════
   Load individual data types
   ═══════════════════════════════════════════ */

export function loadSettingsFromLS(): AppSettings | null {
  return lsGet<AppSettings>(K.settings);
}

export function loadCharactersFromLS(): CharacterRecord[] | null {
  return lsGet<CharacterRecord[]>(K.characters);
}

export function loadMessagesFromLS(characterId: string): ChatMessage[] | null {
  return lsGet<ChatMessage[]>(K.msgPrefix + characterId);
}

export function loadSummaryFromLS(characterId: string): RollingSummary | null {
  return lsGet<RollingSummary>(K.sumPrefix + characterId);
}

/* ═══════════════════════════════════════════
   Full auto-save (call periodically + on unload)
   ═══════════════════════════════════════════ */

export async function autoSaveToLS(): Promise<void> {
  try {
    // Settings
    const settings = await db.settings.get('global');
    if (settings) saveSettingsToLS(settings);

    // Characters
    const chars = await db.characters.toArray();
    saveCharactersToLS(chars);

    // Messages per active character
    for (const char of chars.filter(c => !c.archived)) {
      const msgs = await db.messages
        .where('[characterId+createdAt]')
        .between([char.id, 0], [char.id, Infinity])
        .toArray();
      saveMessagesToLS(char.id, msgs);
    }

    // Summaries
    const summaries = await db.rollingSummaries.toArray();
    for (const s of summaries) saveSummaryToLS(s);

    // Daily summaries
    const daily = await db.dailySummaries.toArray();
    lsSet(K.daily, daily);

    // Timestamp
    lsSet(K.lastSave, new Date().toISOString());

    console.log('[LS] Auto-save complete');
  } catch (err) {
    console.warn('[LS] Auto-save failed:', err);
  }
}

/* ═══════════════════════════════════════════
   Restore from localStorage → IndexedDB
   (Called on every app load, before anything else)
   ═══════════════════════════════════════════ */

export async function restoreFromLSIfNeeded(): Promise<boolean> {
  try {
    // Check if IndexedDB has settings — if yes, it's probably intact
    const idbSettings = await db.settings.get('global');
    const idbCharCount = await db.characters.count();

    // If IDB has both settings and characters, no restore needed
    if (idbSettings && idbCharCount > 0) {
      return false;
    }

    console.log('[LS] IndexedDB appears empty/wiped. Attempting restore from localStorage…');

    let restored = false;

    // Restore settings
    if (!idbSettings) {
      const lsSettings = loadSettingsFromLS();
      if (lsSettings) {
        await db.settings.put(lsSettings);
        restored = true;
        console.log('[LS] Restored settings');
      }
    }

    // Restore characters
    if (idbCharCount === 0) {
      const lsChars = loadCharactersFromLS();
      if (lsChars && lsChars.length > 0) {
        await db.characters.bulkPut(lsChars);
        restored = true;
        console.log(`[LS] Restored ${lsChars.length} characters`);

        // Restore messages for each character
        for (const char of lsChars) {
          const msgs = loadMessagesFromLS(char.id);
          if (msgs && msgs.length > 0) {
            await db.messages.bulkPut(msgs);
            console.log(`[LS] Restored ${msgs.length} messages for ${char.name}`);
          }
          const summary = loadSummaryFromLS(char.id);
          if (summary) {
            await db.rollingSummaries.put(summary);
          }
        }

        // Restore daily summaries
        const daily = lsGet<DailySummary[]>(K.daily);
        if (daily && daily.length > 0) {
          await db.dailySummaries.bulkPut(daily);
        }
      }
    }

    if (restored) {
      console.log('[LS] ✅ Data restored from localStorage backup');
    } else {
      console.log('[LS] No localStorage backup found — fresh start');
    }

    return restored;
  } catch (err) {
    console.error('[LS] Restore from localStorage failed:', err);
    return false;
  }
}

/* ═══════════════════════════════════════════
   Export / Import as JSON (download/upload)
   Works in ALL browsers including QtWebEngine.
   ═══════════════════════════════════════════ */

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

  // Also save to localStorage immediately so it survives IDB wipe
  await autoSaveToLS();
}

/* ═══════════════════════════════════════════
   Debug: check localStorage status
   ═══════════════════════════════════════════ */

export function getStorageStatus(): {
  lastSave: string | null;
  settingsExists: boolean;
  characterCount: number;
  totalKeysUsed: number;
} {
  const lastSave = lsGet<string>(K.lastSave);
  const settings = loadSettingsFromLS();
  const chars = loadCharactersFromLS();

  let totalKeys = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('ctrlaltmoe_')) totalKeys++;
  }

  return {
    lastSave,
    settingsExists: !!settings,
    characterCount: chars?.length ?? 0,
    totalKeysUsed: totalKeys,
  };
}
