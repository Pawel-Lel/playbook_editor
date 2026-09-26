// Cloud sync store: Google sign-in status, and loading/saving playbooks
// from/to the Google Cloud Storage bucket.
//
// Vue concepts used here:
//  - reactive(object): an object Vue watches for changes (see syncState).
//  - watch(source, callback): runs callback when source changes — used to
//    save the auto-sync preference to localStorage.
//  - computed(() => ...): read-only derived values handed to components.
import { reactive, watch, computed } from 'vue'
import * as googleCloudStorage from '../services/gcsClient.js'
import { googleOAuthClientId, gcsBucket, gcsObjectPrefix } from '../config/runtimeConfig.js'

// localStorage key for this browser's Cloud sync preferences.
const CONFIG_KEY = 'playbook-editor:cloud-sync-config:v1'

// Bucket, folder prefix and OAuth Client ID come from the deployment's
// environment (see config/runtimeConfig.js); only per-browser preferences
// are kept in localStorage.
const BUCKET = gcsBucket
const OBJECT_PREFIX = gcsObjectPrefix
const CLIENT_ID = googleOAuthClientId

function defaultConfig() {
  return {
    autoSync: false
  }
}

function loadConfig() {
  try {
    const savedJson = localStorage.getItem(CONFIG_KEY)
    if (savedJson) {
      const savedConfig = JSON.parse(savedJson)
      if (savedConfig && typeof savedConfig === 'object') return { ...defaultConfig(), autoSync: !!savedConfig.autoSync }
    }
  } catch (error) {
    console.warn('Could not read saved cloud sync config.', error)
  }
  return defaultConfig()
}

// THE shared state of this store.
const syncState = reactive({
  config: loadConfig(),
  // Signing in is required to use the app at all (see the router guard);
  // a token restored from this tab's session counts.
  signedIn: googleCloudStorage.isSignedIn(),
  // True once this tab's token has run out: the next sign-in only
  // re-authenticates, it doesn't reload (and overwrite) the playbooks.
  sessionExpired: googleCloudStorage.hadSession() && !googleCloudStorage.isSignedIn(),
  userEmail: googleCloudStorage.getUserEmail(),
  syncing: false,
  lastSyncedAt: null,
  lastError: '',
  lastAction: '', // 'load' | 'save' | ''
  lastLoadSummary: null // { loadedCount, errors: [{name, message}] } | null
})

watch(
  () => syncState.config,
  (newConfig) => {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(newConfig))
    } catch (error) {
      console.warn('Could not persist cloud sync config.', error)
    }
  },
  { deep: true }
)

// playbooks.js registers itself once at module load, handing over the
// actual list/parse/save work (it owns the data and the XML shape) so this
// module never has to import it directly — avoids a circular import while
// still letting playbooks.js trigger an auto-save on every local change.
const syncTargets = new Map() // name -> { loadAll(bucket, prefix), saveAll(bucket, prefix), saveOne(bucket, prefix) }

let expiryTimer = null

// Signs the person out of the app (back to the login page) when their
// short-lived Google token runs out.
function scheduleExpiry() {
  clearTimeout(expiryTimer)
  if (!syncState.signedIn) return
  const millisecondsLeft = googleCloudStorage.getTokenExpiresAt() - Date.now() - 5000
  if (millisecondsLeft <= 0) {
    syncState.signedIn = false
    syncState.sessionExpired = true
    return
  }
  expiryTimer = setTimeout(scheduleExpiry, millisecondsLeft)
}
scheduleExpiry()

export function registerSyncTarget(targetName, { loadAll, saveAll, saveOne }) {
  syncTargets.set(targetName, { loadAll, saveAll, saveOne })
}

let autoSaveTimer = null

/**
 * Called by playbooks.js after every local change. Debounces saving just
 * the *active* playbook's file if auto-sync is on and the person is signed
 * in — saving every playbook on every keystroke would be wasteful when the
 * bucket holds one file per playbook.
 */
export function scheduleAutoSave() {
  if (!syncState.config.autoSync || !syncState.signedIn || !BUCKET) return
  // "Debounce": each new change restarts the 1.5 s countdown, so the save
  // only happens once the person pauses typing.
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  autoSaveTimer = setTimeout(() => {
    Promise.all(
      Array.from(syncTargets.values()).map((syncTarget) =>
        syncTarget.saveOne?.(BUCKET, OBJECT_PREFIX)
      )
    )
      .then(() => {
        syncState.lastSyncedAt = new Date().toISOString()
        syncState.lastError = ''
      })
      .catch((error) => {
        syncState.lastError = error.message
      })
  }, 1500)
}

async function loadFromBucketInternal() {
  syncState.syncing = true
  syncState.lastAction = 'load'
  try {
    let summary = { loadedCount: 0, errors: [] }
    for (const syncTarget of syncTargets.values()) {
      const loadResult = await syncTarget.loadAll(BUCKET, OBJECT_PREFIX)
      if (loadResult) summary = loadResult
    }
    syncState.lastSyncedAt = new Date().toISOString()
    syncState.lastError = summary.errors.length
      ? `Loaded ${summary.loadedCount}, but ${summary.errors.length} file(s) failed — see below.`
      : ''
    syncState.lastLoadSummary = summary
    return summary
  } finally {
    syncState.syncing = false
  }
}

async function saveToBucketInternal() {
  if (!BUCKET) return
  syncState.syncing = true
  syncState.lastAction = 'save'
  try {
    for (const syncTarget of syncTargets.values()) {
      await syncTarget.saveAll(BUCKET, OBJECT_PREFIX)
    }
    syncState.lastSyncedAt = new Date().toISOString()
    syncState.lastError = ''
  } finally {
    syncState.syncing = false
  }
}

// What components call to use this store: const cloudSync = useCloudSyncStore()
export function useCloudSyncStore() {
  const config = computed(() => syncState.config)
  const isConfigured = computed(() => !!BUCKET)
  const canWrite = computed(() => isConfigured.value && !!CLIENT_ID && syncState.signedIn)

  // Merges the given fields into the config, e.g. updateConfig({ autoSync: true }).
  function updateConfig(changedFields) {
    Object.assign(syncState.config, changedFields)
  }

  /**
   * Signs in with Google and checks the account can access the bucket —
   * an account that can't is signed straight back out, with the reason
   * thrown. A fresh sign-in then loads every playbook in the bucket; a
   * re-sign-in after the token expired keeps the local playbooks as they
   * are, so edits made before the expiry aren't overwritten.
   */
  async function connect() {
    if (!CLIENT_ID) throw new Error('Sign-in is not configured — set the GOOGLE_OAUTH_CLIENT_ID environment variable.')
    syncState.lastError = ''
    const reauthenticating = syncState.sessionExpired
    await googleCloudStorage.requestAccessToken(CLIENT_ID)
    if (isConfigured.value) {
      try {
        await googleCloudStorage.checkBucketAccess(BUCKET, OBJECT_PREFIX)
      } catch (accessError) {
        googleCloudStorage.clearAccessToken()
        throw accessError
      }
    }
    syncState.userEmail = await googleCloudStorage.fetchUserEmail()
    syncState.signedIn = true
    syncState.sessionExpired = false
    scheduleExpiry()
    // "Load all playbooks available in the bucket once the person logs in."
    if (isConfigured.value && !reauthenticating) {
      try {
        await loadFromBucketInternal()
      } catch (loadError) {
        // Signed in regardless; the Cloud sync page shows what went wrong.
        syncState.lastError = loadError.message
      }
    }
  }

  function disconnect() {
    googleCloudStorage.clearAccessToken()
    clearTimeout(expiryTimer)
    syncState.signedIn = false
    syncState.sessionExpired = false
    syncState.userEmail = ''
  }

  async function loadFromBucket() {
    if (!isConfigured.value) throw new Error('No bucket configured — set the GCS_BUCKET environment variable.')
    return loadFromBucketInternal()
  }

  async function saveToBucket() {
    if (!isConfigured.value) throw new Error('No bucket configured — set the GCS_BUCKET environment variable.')
    if (!syncState.signedIn) throw new Error('Sign in with Google first.')
    return saveToBucketInternal()
  }

  return {
    config,
    bucket: BUCKET,
    objectPrefix: OBJECT_PREFIX,
    clientId: CLIENT_ID,
    isConfigured,
    canWrite,
    signedIn: computed(() => syncState.signedIn),
    sessionExpired: computed(() => syncState.sessionExpired),
    userEmail: computed(() => syncState.userEmail),
    syncing: computed(() => syncState.syncing),
    lastSyncedAt: computed(() => syncState.lastSyncedAt),
    lastError: computed(() => syncState.lastError),
    lastAction: computed(() => syncState.lastAction),
    lastLoadSummary: computed(() => syncState.lastLoadSummary),
    updateConfig,
    connect,
    disconnect,
    loadFromBucket,
    saveToBucket
  }
}
