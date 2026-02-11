/**
 * Global Zustand store
 */
import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import {
  db,
  DEFAULT_SETTINGS,
  type CharacterRecord,
  type ChatMessage,
  type AppSettings,
  type RollingSummary,
} from '@/lib/db/schema';
import { type ProviderId, type ModelCapabilities, getModelCapabilities } from '@/lib/providers';
import { VRMViewer } from '@/lib/vrm/viewer';

/* ───── Store Types ───── */

interface AppState {
  // VRM
  viewer: VRMViewer;
  vrmLoaded: boolean;
  setVrmLoaded: (v: boolean) => void;

  // Characters
  characters: CharacterRecord[];
  activeCharacterId: string | null;
  loadCharacters: () => Promise<void>;
  selectCharacter: (id: string) => void;
  createCharacter: (name: string) => Promise<string>;
  updateCharacter: (id: string, patch: Partial<CharacterRecord>) => Promise<void>;
  deleteCharacter: (id: string) => Promise<void>;

  // Messages
  messages: ChatMessage[];
  loadMessages: (characterId: string) => Promise<void>;
  addMessage: (msg: Omit<ChatMessage, 'id' | 'createdAt'>) => Promise<ChatMessage>;
  clearMessages: (characterId: string) => Promise<void>;

  // Chat state
  isStreaming: boolean;
  streamingContent: string;
  setStreaming: (v: boolean) => void;
  setStreamingContent: (v: string) => void;

  // Settings
  settings: AppSettings;
  loadSettings: () => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  getCapabilities: () => ModelCapabilities;

  // UI
  sidebarOpen: boolean;
  settingsOpen: boolean;
  characterEditId: string | null;
  vrmVisible: boolean;
  toggleSidebar: () => void;
  toggleSettings: () => void;
  setCharacterEditId: (id: string | null) => void;
  setVrmVisible: (v: boolean) => void;

  // Rolling summary
  rollingSummary: RollingSummary | null;
  loadRollingSummary: (characterId: string) => Promise<void>;
  saveRollingSummary: (characterId: string, content: string) => Promise<void>;
}

const DEFAULT_VRM_URL = '/vrm/AvatarSample_B.vrm'; // legacy fallback

/** Built-in VRM models are now listed via /manifest/files.json */
export const BUILTIN_VRM_MODELS: { id: string; label: string; url: string }[] = [];

export const useAppStore = create<AppState>((set, get) => ({
  // VRM
  viewer: new VRMViewer(),
  vrmLoaded: false,
  setVrmLoaded: (v) => set({ vrmLoaded: v }),

  // Characters
  characters: [],
  activeCharacterId: null,

  loadCharacters: async () => {
    const allChars = await db.characters.toArray();
    const active = allChars.filter(c => !c.archived);
    set({ characters: active.sort((a, b) => b.updatedAt - a.updatedAt) });
  },

  selectCharacter: (id) => {
    set({ activeCharacterId: id });
    get().loadMessages(id);
    get().loadRollingSummary(id);

    // Load VRM for this character
    const char = get().characters.find(c => c.id === id);
    if (char?.vrmModelUrl) {
      get().viewer.loadVRM(char.vrmModelUrl, char.vrmSettings).then(() => set({ vrmLoaded: true }));
    }
  },

  createCharacter: async (name) => {
    const id = uuid();
    const now = Date.now();
    const char: CharacterRecord = {
      id,
      name,
      speakingStyle: 'friendly and casual',
      personality: 'kind, curious, and playful',
      likes: '',
      dislikes: '',
      personaText: '',
      vrmModelSource: 'url',
      vrmModelUrl: DEFAULT_VRM_URL,
      color: '#A7F3D0', // mint
      icon: '✨',
      affection: 50,
      trust: 50,
      emotionState: { happy: 0.3, angry: 0, sad: 0, surprised: 0 },
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    await db.characters.add(char);
    await get().loadCharacters();
    return id;
  },

  updateCharacter: async (id, patch) => {
    await db.characters.update(id, { ...patch, updatedAt: Date.now() });
    await get().loadCharacters();
    // If active char, update VRM if model changed
    if (id === get().activeCharacterId && (patch.vrmModelUrl || patch.vrmSettings)) {
      const char = get().characters.find(c => c.id === id);
      if (char) {
        get().viewer.loadVRM(char.vrmModelUrl, char.vrmSettings).then(() => set({ vrmLoaded: true }));
      }
    }
  },

  deleteCharacter: async (id) => {
    await db.characters.update(id, { archived: true });
    await get().loadCharacters();
    if (get().activeCharacterId === id) {
      const chars = get().characters;
      if (chars.length > 0) {
        get().selectCharacter(chars[0].id);
      } else {
        set({ activeCharacterId: null, messages: [] });
      }
    }
  },

  // Messages
  messages: [],

  loadMessages: async (characterId) => {
    const msgs = await db.messages
      .where('[characterId+createdAt]')
      .between([characterId, 0], [characterId, Infinity])
      .toArray();
    set({ messages: msgs });
  },

  addMessage: async (msg) => {
    const full: ChatMessage = {
      ...msg,
      id: uuid(),
      createdAt: Date.now(),
    };
    await db.messages.add(full);
    set(s => ({ messages: [...s.messages, full] }));

    // Update character timestamp
    if (msg.characterId) {
      await db.characters.update(msg.characterId, { updatedAt: Date.now() });
    }

    return full;
  },

  clearMessages: async (characterId) => {
    await db.messages.where('characterId').equals(characterId).delete();
    set({ messages: [] });
  },

  // Chat state
  isStreaming: false,
  streamingContent: '',
  setStreaming: (v) => set({ isStreaming: v }),
  setStreamingContent: (v) => set({ streamingContent: v }),

  // Settings
  settings: { ...DEFAULT_SETTINGS },

  loadSettings: async () => {
    const saved = await db.settings.get('global');
    if (saved) {
      set({ settings: saved });
    } else {
      await db.settings.put(DEFAULT_SETTINGS);
    }
  },

  updateSettings: async (patch) => {
    const current = get().settings;
    const updated = { ...current, ...patch };
    await db.settings.put(updated);
    set({ settings: updated });
  },

  getCapabilities: () => {
    const { provider, model } = get().settings;
    return getModelCapabilities(provider as ProviderId, model);
  },

  // UI
  sidebarOpen: true,
  settingsOpen: false,
  characterEditId: null,
  vrmVisible: true,
  toggleSidebar: () => set(s => ({ sidebarOpen: !s.sidebarOpen })),
  toggleSettings: () => set(s => ({ settingsOpen: !s.settingsOpen })),
  setCharacterEditId: (id) => set({ characterEditId: id }),
  setVrmVisible: (v) => set({ vrmVisible: v }),

  // Rolling summary
  rollingSummary: null,

  loadRollingSummary: async (characterId) => {
    const summaries = await db.rollingSummaries.where('characterId').equals(characterId).toArray();
    set({ rollingSummary: summaries[0] || null });
  },

  saveRollingSummary: async (characterId, content) => {
    const existing = get().rollingSummary;
    if (existing) {
      await db.rollingSummaries.update(existing.id, { content, updatedAt: Date.now(), coveredUntil: Date.now() });
    } else {
      const entry = {
        id: uuid(),
        characterId,
        content,
        coveredUntil: Date.now(),
        updatedAt: Date.now(),
      };
      await db.rollingSummaries.add(entry);
      set({ rollingSummary: entry });
    }
  },
}));
