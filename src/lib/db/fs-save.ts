/**
 * File System Access API — Save/Load data to a user-picked directory.
 *
 * Browsers that support showDirectoryPicker() (Chrome, Edge, QtWebEngine)
 * allow persistent read/write to a real directory. The handle is persisted
 * in IndexedDB so the user only has to pick once.
 *
 * Fallback: if File System Access API is unavailable, we download JSON files.
 */

const DIR_HANDLE_KEY = 'ctrlaltmoe_dir_handle';
const SAVE_FILE = 'ctrlaltmoe-data.json';

/* ───── Check support ───── */
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/* ───── Store / retrieve directory handle ───── */

let cachedHandle: FileSystemDirectoryHandle | null = null;

/**
 * Save the directory handle to IndexedDB for persistence across sessions.
 */
async function persistHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    const request = indexedDB.open('CtrlAltMoeFSHandles', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('handles');
    };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(handle, DIR_HANDLE_KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[fs-save] Failed to persist directory handle:', err);
  }
}

/**
 * Load a previously saved directory handle from IndexedDB.
 */
async function loadPersistedHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const request = indexedDB.open('CtrlAltMoeFSHandles', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('handles');
    };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction('handles', 'readonly');
    const result = await new Promise<FileSystemDirectoryHandle | undefined>((resolve, reject) => {
      const req = tx.objectStore('handles').get(DIR_HANDLE_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result ?? null;
  } catch {
    return null;
  }
}

/* ───── Public API ───── */

/**
 * Get the current save directory name (just the folder name for display).
 */
export async function getSaveDirectoryName(): Promise<string | null> {
  if (cachedHandle) return cachedHandle.name;
  const handle = await loadPersistedHandle();
  if (handle) cachedHandle = handle;
  return handle?.name ?? null;
}

/**
 * Prompt user to pick a save directory.
 */
export async function pickSaveDirectory(): Promise<string | null> {
  if (!isFileSystemAccessSupported()) return null;

  try {
    // @ts-expect-error — showDirectoryPicker exists in Chromium
    const handle: FileSystemDirectoryHandle = await window.showDirectoryPicker({
      id: 'ctrlaltmoe-save',
      mode: 'readwrite',
      startIn: 'documents',
    });
    cachedHandle = handle;
    await persistHandle(handle);
    return handle.name;
  } catch (err) {
    // User cancelled
    if ((err as DOMException).name === 'AbortError') return null;
    console.error('[fs-save] pickSaveDirectory error:', err);
    return null;
  }
}

/**
 * Verify we still have permission to the directory (needed after browser restart).
 */
async function verifyPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    // @ts-expect-error — queryPermission exists in Chromium
    if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
    // @ts-expect-error — requestPermission exists in Chromium
    return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

/**
 * Save data to the chosen directory as a JSON file.
 */
export async function saveToDirectory(data: object): Promise<boolean> {
  let handle = cachedHandle ?? await loadPersistedHandle();
  if (!handle) return false;
  cachedHandle = handle;

  if (!(await verifyPermission(handle))) {
    console.warn('[fs-save] No write permission to directory');
    return false;
  }

  try {
    const fileHandle = await handle.getFileHandle(SAVE_FILE, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
    console.log(`[fs-save] Saved to ${handle.name}/${SAVE_FILE}`);
    return true;
  } catch (err) {
    console.error('[fs-save] Save failed:', err);
    return false;
  }
}

/**
 * Load data from the chosen directory.
 */
export async function loadFromDirectory(): Promise<object | null> {
  let handle = cachedHandle ?? await loadPersistedHandle();
  if (!handle) return null;
  cachedHandle = handle;

  if (!(await verifyPermission(handle))) return null;

  try {
    const fileHandle = await handle.getFileHandle(SAVE_FILE);
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch {
    // File doesn't exist yet — that's OK
    return null;
  }
}

/**
 * Clear the saved directory handle.
 */
export async function clearSaveDirectory(): Promise<void> {
  cachedHandle = null;
  try {
    const request = indexedDB.open('CtrlAltMoeFSHandles', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('handles');
    };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').delete(DIR_HANDLE_KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore errors
  }
}
