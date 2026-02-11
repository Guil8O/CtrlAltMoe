/**
 * Ctrl+Alt+Moe — IndexedDB Schema (Dexie)
 * Version: 1
 */
import Dexie, { type Table } from 'dexie';

/* ────────────────────────────────────────── Types ── */

/**
 * Per-character VRM pose / physics settings.
 * Allows tuning the rest pose for different models (A-pose vs T-pose,
 * varying arm angles) and spring-bone behaviour.
 */
export interface VrmSettings {
  /** Base arm Z-rotation angle (radians). 0 = T-pose, ~1.15 = arms at sides.
   *  Default: 1.15. Affects both upper arms symmetrically. */
  armRestAngle: number;
  /** Additional forward pitch on upper arms (radians). Default: 0.2 */
  armForwardPitch: number;
  /** Animation arm-spread bias (degrees, applied during Mixamo retarget).
   *  Positive = push arms outward (away from body).
   *  Negative = push arms inward. Range: roughly -30 to +60.
   *  Default: 20. Adjust per-model to prevent arm/body penetration. */
  armSpreadBias: number;
  /** Multiplier for spring-bone stiffness (0.1–3.0). Default: 1.0 */
  springBoneStiffness: number;
  /** Multiplier for spring-bone gravity (0–3.0). Default: 1.0 */
  springBoneGravity: number;
  /** Whether to enable wind-like external force on springs. Default: false */
  springBoneWind: boolean;
}

export const DEFAULT_VRM_SETTINGS: VrmSettings = {
  armRestAngle: 1.15,
  armForwardPitch: 0.2,
  armSpreadBias: 20,
  springBoneStiffness: 1.0,
  springBoneGravity: 1.0,
  springBoneWind: false,
};

export interface CharacterRecord {
  id: string;
  name: string;
  age?: number;
  speakingStyle: string;
  personality: string;
  likes: string;
  dislikes: string;
  personaText: string;
  vrmModelSource: 'file' | 'url';
  vrmModelUrl: string;           // object-url or remote url
  vrmModelBlobKey?: string;      // key in blobs table for local file
  color: string;                 // accent colour hex
  icon: string;                  // emoji or icon id
  affection: number;             // 0..100
  trust: number;                 // 0..100
  emotionState: EmotionState;
  vrmSettings?: VrmSettings;     // per-character VRM pose/physics config
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface EmotionState {
  happy: number;    // 0..1
  angry: number;
  sad: number;
  surprised: number;
}

export interface ChatMessage {
  id: string;
  characterId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  meta?: ResponseMeta;
  attachments?: Attachment[];
  createdAt: number;
}

export interface Attachment {
  type: 'image' | 'file';
  name: string;
  mimeType: string;
  size: number;
  dataUrl?: string;   // base64 data-url for small files
  blobKey?: string;    // key in blobs table for large files
}

export interface ResponseMeta {
  emotion?: EmotionState;
  gesture?: string;
  affectionDelta?: number;
  userMoodEstimate?: string;
}

export interface DailySummary {
  id: string;
  characterId: string;
  date: string;                // YYYY-MM-DD
  keyEvents: string[];
  userEmotion: string;
  userTraits: string[];
  openThreads: string[];
  relationshipSnapshot: {
    affection: number;
    trust: number;
  };
  createdAt: number;
}

export interface RollingSummary {
  id: string;
  characterId: string;
  content: string;
  coveredUntil: number;        // timestamp
  updatedAt: number;
}

export interface BlobRecord {
  key: string;
  data: Blob;
  createdAt: number;
}

export interface AppSettings {
  key: string;                 // singleton "global"
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  retentionDays: number;
  theme: 'light' | 'dark' | 'system';
  accentColor: 'mint' | 'lilac' | 'peach';
  webSearchEnabled: boolean;
  language: 'en' | 'ja' | 'ko' | 'zh' | 'es';
  customProviderCapabilities?: Record<string, boolean>;
}

/* ────────────────────────────────── Dexie Database ── */

export class MoeDB extends Dexie {
  characters!: Table<CharacterRecord, string>;
  messages!: Table<ChatMessage, string>;
  dailySummaries!: Table<DailySummary, string>;
  rollingSummaries!: Table<RollingSummary, string>;
  blobs!: Table<BlobRecord, string>;
  settings!: Table<AppSettings, string>;

  constructor() {
    super('CtrlAltMoeDB');

    this.version(1).stores({
      characters:     'id, name, archived, updatedAt',
      messages:       'id, characterId, createdAt, [characterId+createdAt]',
      dailySummaries: 'id, characterId, date, [characterId+date]',
      rollingSummaries: 'id, characterId',
      blobs:          'key',
      settings:       'key',
    });

    // v2 — add vrmSettings column (no index change, schema stays compatible)
    this.version(2).stores({
      characters:     'id, name, archived, updatedAt',
      messages:       'id, characterId, createdAt, [characterId+createdAt]',
      dailySummaries: 'id, characterId, date, [characterId+date]',
      rollingSummaries: 'id, characterId',
      blobs:          'key',
      settings:       'key',
    });
  }
}

export const db = new MoeDB();

/* ───── Default settings ───── */
export const DEFAULT_SETTINGS: AppSettings = {
  key: 'global',
  provider: 'chatgpt',
  model: 'gpt-4o-mini',
  apiKey: '',
  baseUrl: '',
  retentionDays: 30,
  theme: 'system',
  accentColor: 'mint',
  webSearchEnabled: false,
  language: 'en',
};

/* ───── Schema Version Info (for export/import) ───── */
export const SCHEMA_VERSION = 2;
