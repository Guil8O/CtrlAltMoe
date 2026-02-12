/**
 * Persistent Storage Layer — hybrid Plasma file bridge + localStorage.
 *
 * Priority order:
 *   1. Plasma Bridge (file I/O via QML WebChannel) — survives reboots
 *   2. localStorage — fast, works in all browsers, but may be wiped
 *      in KDE Plasma WebEngineView on restart.
 *
 * Data is ALWAYS saved to both layers when the bridge is available,
 * so localStorage acts as a hot cache while files are the durable copy.
 *
 * Key layout (same for both layers):
 *   settings           → AppSettings
 *   characters         → CharacterRecord[]
 *   msgs_{characterId} → ChatMessage[]
 *   summary_{characterId} → RollingSummary
 *   daily              → DailySummary[]
 *   lastSave           → ISO timestamp
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

import {
  initBridge,
  isBridgeReady,
  bridgeSave,
  bridgeLoad,
  bridgeGetSavePath,
  isPlasmaEnvironment,
} from './plasma-bridge';

/* ═══════════════════════════════════════════
   localStorage helpers (Layer 2 — fast cache)
   ═══════════════════════════════════════════ */

const LS_PREFIX = 'ctrlaltmoe_';

function lsSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch (e) {
    console.warn('[Storage] LS write failed:', key, e);
  }
}

function lsGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/* ═══════════════════════════════════════════
   Unified save — writes to both bridge + LS
   ═══════════════════════════════════════════ */

async function persistSet(key: string, value: unknown): Promise<void> {
  // Always write to LS (fast, synchronous-ish)
  lsSet(key, value);
  // Also write to file bridge if available
  if (isBridgeReady()) {
    await bridgeSave(key, value);
  }
}

async function persistGet<T>(key: string): Promise<T | null> {
  // Try file bridge first (durable)
  if (isBridgeReady()) {
    const fromBridge = await bridgeLoad<T>(key);
    if (fromBridge !== null) return fromBridge;
  }
  // Fall back to localStorage
  return lsGet<T>(key);
}

/* ═══════════════════════════════════════════
   Save individual data types
   ═══════════════════════════════════════════ */

export async function saveSettingsToLS(settings: AppSettings): Promise<void> {
  await persistSet('settings', settings);
}

export async function saveCharactersToLS(characters: CharacterRecord[]): Promise<void> {
  await persistSet('characters', characters);
}

export async function saveMessagesToLS(characterId: string, messages: ChatMessage[]): Promise<void> {
  await persistSet('msgs_' + characterId, messages);
}

export async function saveSummaryToLS(summary: RollingSummary): Promise<void> {
  await persistSet('summary_' + summary.characterId, summary);
}

/* ═══════════════════════════════════════════
   Load individual data types
   ═══════════════════════════════════════════ */

export async function loadSettingsFromStorage(): Promise<AppSettings | null> {
  return persistGet<AppSettings>('settings');
}

export async function loadCharactersFromStorage(): Promise<CharacterRecord[] | null> {
  return persistGet<CharacterRecord[]>('characters');
}

export async function loadMessagesFromStorage(characterId: string): Promise<ChatMessage[] | null> {
  return persistGet<ChatMessage[]>('msgs_' + characterId);
}

export async function loadSummaryFromStorage(characterId: string): Promise<RollingSummary | null> {
  return persistGet<RollingSummary>('summary_' + characterId);
}

/* ═══════════════════════════════════════════
   Synchronous LS loaders (for legacy compat)
   ═══════════════════════════════════════════ */

export function loadSettingsFromLS(): AppSettings | null {
  return lsGet<AppSettings>('settings');
}

export function loadCharactersFromLS(): CharacterRecord[] | null {
  return lsGet<CharacterRecord[]>('characters');
}

export function loadMessagesFromLS(characterId: string): ChatMessage[] | null {
  return lsGet<ChatMessage[]>('msgs_' + characterId);
}

export function loadSummaryFromLS(characterId: string): RollingSummary | null {
  return lsGet<RollingSummary>('summary_' + characterId);
}

/* ═══════════════════════════════════════════
   Initialise the storage layer
   Called once at app startup.
   ═══════════════════════════════════════════ */

let _initialised = false;

export async function initStorage(): Promise<void> {
  if (_initialised) return;
  _initialised = true;

  if (isPlasmaEnvironment()) {
    const ok = await initBridge();
    console.log('[Storage] Plasma bridge:', ok ? '✅ connected' : '❌ unavailable');
  } else {
    console.log('[Storage] Browser mode — using localStorage');
  }
}

/* ═══════════════════════════════════════════
   Full auto-save (IDB → persistent storage)
   Called periodically + on mutations.
   ═══════════════════════════════════════════ */

export async function autoSaveToLS(): Promise<void> {
  try {
    // Settings
    const settings = await db.settings.get('global');
    if (settings) await saveSettingsToLS(settings);

    // Characters
    const chars = await db.characters.toArray();
    await saveCharactersToLS(chars);

    // Messages per active (non-archived) character
    for (const char of chars.filter(c => !c.archived)) {
      const msgs = await db.messages
        .where('[characterId+createdAt]')
        .between([char.id, 0], [char.id, Infinity])
        .toArray();
      await saveMessagesToLS(char.id, msgs);
    }

    // Rolling summaries
    const summaries = await db.rollingSummaries.toArray();
    for (const s of summaries) await saveSummaryToLS(s);

    // Daily summaries
    const daily = await db.dailySummaries.toArray();
    await persistSet('daily', daily);

    // Timestamp
    await persistSet('lastSave', new Date().toISOString());

    console.log('[Storage] Auto-save complete', isBridgeReady() ? '(file+LS)' : '(LS only)');
  } catch (err) {
    console.warn('[Storage] Auto-save failed:', err);
  }
}

/* ═══════════════════════════════════════════
   Restore: persistent storage → IndexedDB
   Called on every app load.  If IDB looks
   intact, this is a no-op.
   ═══════════════════════════════════════════ */

export async function restoreFromLSIfNeeded(): Promise<boolean> {
  try {
    // Ensure bridge is initialised first
    await initStorage();

    const idbSettings = await db.settings.get('global');
    const idbCharCount = await db.characters.count();

    // IDB looks intact — no restore needed
    if (idbSettings && idbCharCount > 0) {
      return false;
    }

    console.log('[Storage] IndexedDB appears empty. Attempting restore…');
    let restored = false;

    // Restore settings
    if (!idbSettings) {
      const settings = await loadSettingsFromStorage();
      if (settings) {
        await db.settings.put(settings);
        restored = true;
        console.log('[Storage] Restored settings');
      }
    }

    // Restore characters + their messages/summaries
    if (idbCharCount === 0) {
      const chars = await loadCharactersFromStorage();
      if (chars && chars.length > 0) {
        await db.characters.bulkPut(chars);
        restored = true;
        console.log(`[Storage] Restored ${chars.length} characters`);

        for (const char of chars) {
          const msgs = await loadMessagesFromStorage(char.id);
          if (msgs && msgs.length > 0) {
            await db.messages.bulkPut(msgs);
            console.log(`[Storage] Restored ${msgs.length} messages for ${char.name}`);
          }
          const summary = await loadSummaryFromStorage(char.id);
          if (summary) {
            await db.rollingSummaries.put(summary);
          }
        }

        // Daily summaries
        const daily = await persistGet<DailySummary[]>('daily');
        if (daily && daily.length > 0) {
          await db.dailySummaries.bulkPut(daily);
        }
      }
    }

    if (restored) {
      console.log('[Storage] ✅ Data restored from', isBridgeReady() ? 'file bridge' : 'localStorage');
    } else {
      console.log('[Storage] No backup found — fresh start');
    }

    return restored;
  } catch (err) {
    console.error('[Storage] Restore failed:', err);
    return false;
  }
}

/* ═══════════════════════════════════════════
   Export / Import as JSON file
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

  // Persist to both LS + file bridge
  await autoSaveToLS();
}

/* ═══════════════════════════════════════════
   Debug / Status
   ═══════════════════════════════════════════ */

export function getStorageStatus(): {
  lastSave: string | null;
  settingsExists: boolean;
  characterCount: number;
  totalKeysUsed: number;
  backend: string;
  savePath: string | null;
} {
  const lastSave = lsGet<string>('lastSave');
  const settings = lsGet<AppSettings>('settings');
  const chars = lsGet<CharacterRecord[]>('characters');

  let totalKeys = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(LS_PREFIX)) totalKeys++;
  }

  return {
    lastSave,
    settingsExists: !!settings,
    characterCount: chars?.length ?? 0,
    totalKeysUsed: totalKeys,
    backend: isBridgeReady() ? 'plasma-file-bridge' : 'localStorage',
    savePath: null, // resolved async, caller can use bridgeGetSavePath()
  };
}

/**
 * Get the save directory path (async — queries bridge if available).
 */
export async function getSaveDirectory(): Promise<string | null> {
  if (isBridgeReady()) {
    return bridgeGetSavePath();
  }
  return null;
}
