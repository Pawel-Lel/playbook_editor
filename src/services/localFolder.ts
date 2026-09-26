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

export function isSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

// IndexedDB is the browser's built-in database; unlike localStorage it can
// store a folder handle. These two helpers open it and run one operation.
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const openRequest = indexedDB.open(DB_NAME, 1)
    openRequest.onupgradeneeded = () => openRequest.result.createObjectStore(DB_STORE)
    openRequest.onsuccess = () => resolve(openRequest.result)
    openRequest.onerror = () => reject(openRequest.error)
  })
}

// Runs `operation(objectStore)` in a transaction and resolves with its result.
async function runInHandleStore<Result>(
  transactionMode: IDBTransactionMode,
  operation: (handleStore: IDBObjectStore) => IDBRequest<Result>
): Promise<Result> {
  const database = await openDatabase()
  try {
    return await new Promise<Result>((resolve, reject) => {
      const transaction = database.transaction(DB_STORE, transactionMode)
      const operationRequest = operation(transaction.objectStore(DB_STORE))
      transaction.oncomplete = () => resolve(operationRequest?.result)
      transaction.onerror = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
}

// The chosen folder, kept in memory after the first lookup.
let rememberedFolderHandle: FileSystemDirectoryHandle | null = null

/**
 * The previously chosen folder, if any (from memory or IndexedDB). Doesn't
 * check permission — that happens on write, inside a user gesture.
 */
export async function getRememberedFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (rememberedFolderHandle || !isSupported()) return rememberedFolderHandle
  try {
    rememberedFolderHandle = (await runInHandleStore('readonly', (handleStore) => handleStore.get(DIR_KEY))) || null
  } catch (error) {
    console.warn('Could not read the remembered save folder.', error)
  }
  return rememberedFolderHandle
}

/**
 * Prompts for a folder and remembers it. Throws an AbortError if the
 * person cancels the picker.
 */
export async function chooseFolder(): Promise<FileSystemDirectoryHandle> {
  const folderHandle = await window.showDirectoryPicker({ id: 'playbook-editor-save', mode: 'readwrite' })
  rememberedFolderHandle = folderHandle
  try {
    await runInHandleStore('readwrite', (handleStore) => handleStore.put(folderHandle, DIR_KEY))
  } catch (error) {
    console.warn('Could not remember the save folder.', error)
  }
  return folderHandle
}

// Asks the browser for write permission on the folder, if not already granted.
async function ensureWritable(folderHandle: FileSystemDirectoryHandle): Promise<boolean> {
  const permissionOptions = { mode: 'readwrite' as const }
  if ((await folderHandle.queryPermission(permissionOptions)) === 'granted') return true
  return (await folderHandle.requestPermission(permissionOptions)) === 'granted'
}

/**
 * Writes (creating or overwriting) `fileName` in the remembered folder,
 * prompting for a folder first if none is remembered or its permission
 * was refused. Must be called from a user gesture (e.g. a click).
 * @returns the folder's name, for status messages
 */
export async function writeTextFile(fileName: string, content: string): Promise<string> {
  let folderHandle = await getRememberedFolder()
  if (!folderHandle || !(await ensureWritable(folderHandle))) folderHandle = await chooseFolder()
  const fileHandle = await folderHandle.getFileHandle(fileName, { create: true })
  const fileWriter = await fileHandle.createWritable()
  await fileWriter.write(content)
  await fileWriter.close()
  return folderHandle.name
}

