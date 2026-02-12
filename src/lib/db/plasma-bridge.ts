/**
 * Plasma WebChannel Bridge — File I/O via KDE Plasma widget.
 *
 * When running inside a KDE Plasma WebEngineView, this module connects
 * to the QML `fileBridge` object via QtWebChannel.  The bridge can
 * read/write JSON files on the local filesystem, surviving reboots.
 *
 * Detection:
 *   window.qt?.webChannelTransport exists  →  we are in QtWebEngine
 *
 * Protocol:
 *   Web calls  fileBridge.save(key, json, cbId)
 *   QML writes the file, then calls back via
 *     webView.runJavaScript("window.__plasmaBridgeCb(cbId, result)")
 *
 * Fallback:
 *   When NOT in Plasma, all methods return null / false and the caller
 *   should fall through to localStorage.
 */

/* ─── Types ─── */

interface QtTransport {
  webChannelTransport: unknown;
}

interface FileBridgeRemote {
  save:      (key: string, json: string, cbId: string) => void;
  load:      (key: string, cbId: string) => void;
  listKeys:  (cbId: string) => void;
  remove:    (key: string, cbId: string) => void;
  getSavePath: (cbId: string) => void;
}

/* ─── Singleton State ─── */

let bridge: FileBridgeRemote | null = null;
let initPromise: Promise<boolean> | null = null;
let cbCounter = 0;
const pendingCbs = new Map<string, (result: string) => void>();

// Global callback handler — QML calls this via runJavaScript
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__plasmaBridgeCb = (cbId: string, result: string) => {
    const cb = pendingCbs.get(cbId);
    if (cb) {
      pendingCbs.delete(cbId);
      cb(result);
    }
  };
}

/* ─── Helpers ─── */

function nextCbId(): string {
  return `cb_${++cbCounter}_${Date.now()}`;
}

function callBridge(method: keyof FileBridgeRemote, ...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!bridge) {
      reject(new Error('Bridge not connected'));
      return;
    }
    const cbId = nextCbId();
    const timer = setTimeout(() => {
      pendingCbs.delete(cbId);
      reject(new Error(`Bridge call ${method} timed out`));
    }, 10_000);

    pendingCbs.set(cbId, (result) => {
      clearTimeout(timer);
      resolve(result);
    });

    // Call QML method with key(s) + callbackId
    (bridge[method] as Function)(...args, cbId);
  });
}

/* ─── Public API ─── */

/**
 * Returns true if we are inside a KDE Plasma WebEngineView
 * and the fileBridge is available.
 */
export function isPlasmaEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window as unknown as { qt?: QtTransport }).qt?.webChannelTransport;
}

/**
 * Initialise the WebChannel connection.
 * Returns true if bridge is available, false otherwise.
 * Safe to call multiple times (idempotent).
 */
export function initBridge(): Promise<boolean> {
  if (initPromise) return initPromise;

  initPromise = new Promise((resolve) => {
    if (!isPlasmaEnvironment()) {
      console.log('[PlasmaBridge] Not in Plasma — file bridge disabled');
      resolve(false);
      return;
    }

    // Dynamically load qwebchannel.js (bundled with Qt WebEngine)
    const script = document.createElement('script');
    script.src = 'qrc:///qtwebchannel/qwebchannel.js';
    script.onload = () => {
      try {
        const QWebChannel = (window as unknown as Record<string, unknown>).QWebChannel as new (
          transport: unknown,
          cb: (ch: { objects: Record<string, FileBridgeRemote> }) => void,
        ) => void;

        const transport = ((window as unknown as { qt: QtTransport }).qt).webChannelTransport;

        new QWebChannel(transport, (ch) => {
          bridge = ch.objects.fileBridge ?? null;
          if (bridge) {
            console.log('[PlasmaBridge] ✅ Connected to fileBridge');
            resolve(true);
          } else {
            console.warn('[PlasmaBridge] fileBridge not found in channel objects');
            resolve(false);
          }
        });
      } catch (err) {
        console.error('[PlasmaBridge] WebChannel init error:', err);
        resolve(false);
      }
    };
    script.onerror = () => {
      console.warn('[PlasmaBridge] Failed to load qwebchannel.js');
      resolve(false);
    };
    document.head.appendChild(script);
  });

  return initPromise;
}

/**
 * Is the bridge currently connected and ready?
 */
export function isBridgeReady(): boolean {
  return bridge !== null;
}

/**
 * Save a JSON-serialisable value to a file on disk.
 * @param key   Filename stem (e.g. "settings", "msgs_abc123")
 * @param data  Any JSON-serialisable value
 */
export async function bridgeSave(key: string, data: unknown): Promise<boolean> {
  if (!bridge) return false;
  try {
    const json = JSON.stringify(data);
    const result = await callBridge('save', key, json);
    return result === 'ok';
  } catch (err) {
    console.warn('[PlasmaBridge] save failed:', key, err);
    return false;
  }
}

/**
 * Load a value from a file on disk.
 * @returns  Parsed JSON, or null if not found.
 */
export async function bridgeLoad<T = unknown>(key: string): Promise<T | null> {
  if (!bridge) return null;
  try {
    const raw = await callBridge('load', key);
    if (!raw || raw === '__NOTFOUND__') return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn('[PlasmaBridge] load failed:', key, err);
    return null;
  }
}

/**
 * List all saved keys (filenames without .json).
 */
export async function bridgeListKeys(): Promise<string[]> {
  if (!bridge) return [];
  try {
    const raw = await callBridge('listKeys');
    if (!raw || raw.trim() === '') return [];
    return raw.trim().split('\n').filter(Boolean);
  } catch (err) {
    console.warn('[PlasmaBridge] listKeys failed:', err);
    return [];
  }
}

/**
 * Delete a saved file.
 */
export async function bridgeRemove(key: string): Promise<boolean> {
  if (!bridge) return false;
  try {
    const result = await callBridge('remove', key);
    return result === 'ok';
  } catch (err) {
    console.warn('[PlasmaBridge] remove failed:', key, err);
    return false;
  }
}

/**
 * Get the current save directory path.
 */
export async function bridgeGetSavePath(): Promise<string | null> {
  if (!bridge) return null;
  try {
    return await callBridge('getSavePath');
  } catch {
    return null;
  }
}
