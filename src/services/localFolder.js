// Writes playbook files into a folder on the person's own disk, straight
// from the browser, via the File System Access API (Chromium browsers:
// Chrome, Edge, Opera). The chosen folder's handle is remembered in
// IndexedDB so later saves go to the same place without asking again —
// the browser only re-confirms write permission once per session.
//
// Browsers without the API (Firefox, Safari) can't write into a folder;
// callers fall back to a plain file download there (isSupported() false).

const DB_NAME = 'playbook-editor'
const DB_STORE = 'handles'
const DIR_KEY = 'local-save-dir'

export function isSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idb(mode, fn) {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, mode)
      const req = fn(tx.objectStore(DB_STORE))
      tx.oncomplete = () => resolve(req?.result)
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

let dirHandle = null

/**
 * The previously chosen folder, if any (from memory or IndexedDB). Doesn't
 * check permission — that happens on write, inside a user gesture.
 * @returns {Promise<FileSystemDirectoryHandle|null>}
 */
export async function getRememberedFolder() {
  if (dirHandle || !isSupported()) return dirHandle
  try {
    dirHandle = (await idb('readonly', (s) => s.get(DIR_KEY))) || null
  } catch (e) {
    console.warn('Could not read the remembered save folder.', e)
  }
  return dirHandle
}

/**
 * Prompts for a folder and remembers it. Throws an AbortError if the
 * person cancels the picker.
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
export async function chooseFolder() {
  const handle = await window.showDirectoryPicker({ id: 'playbook-editor-save', mode: 'readwrite' })
  dirHandle = handle
  try {
    await idb('readwrite', (s) => s.put(handle, DIR_KEY))
  } catch (e) {
    console.warn('Could not remember the save folder.', e)
  }
  return handle
}

async function ensureWritable(handle) {
  const opts = { mode: 'readwrite' }
  if ((await handle.queryPermission(opts)) === 'granted') return true
  return (await handle.requestPermission(opts)) === 'granted'
}

/**
 * Writes (creating or overwriting) `fileName` in the remembered folder,
 * prompting for a folder first if none is remembered or its permission
 * was refused. Must be called from a user gesture (e.g. a click).
 * @param {string} fileName
 * @param {string} content
 * @returns {Promise<string>} the folder's name, for status messages
 */
export async function writeTextFile(fileName, content) {
  let handle = await getRememberedFolder()
  if (!handle || !(await ensureWritable(handle))) handle = await chooseFolder()
  const fileHandle = await handle.getFileHandle(fileName, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(content)
  await writable.close()
  return handle.name
}
