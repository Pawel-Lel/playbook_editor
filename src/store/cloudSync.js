import { reactive, watch, computed } from 'vue'
import * as gcs from '../services/gcsClient.js'
import { googleOAuthClientId, gcsBucket, gcsObjectPrefix } from '../config/runtimeConfig.js'

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
    const raw = localStorage.getItem(CONFIG_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') return { ...defaultConfig(), autoSync: !!parsed.autoSync }
    }
  } catch (e) {
    console.warn('Could not read saved cloud sync config.', e)
  }
  return defaultConfig()
}

const state = reactive({
  config: loadConfig(),
  // Signing in is required to use the app at all (see the router guard);
  // a token restored from this tab's session counts.
  signedIn: gcs.isSignedIn(),
  // True once this tab's token has run out: the next sign-in only
  // re-authenticates, it doesn't reload (and overwrite) the playbooks.
  sessionExpired: gcs.hadSession() && !gcs.isSignedIn(),
  userEmail: gcs.getUserEmail(),
  syncing: false,
  lastSyncedAt: null,
  lastError: '',
  lastAction: '', // 'load' | 'save' | ''
  lastLoadSummary: null // { loadedCount, errors: [{name, message}] } | null
})

watch(
  () => state.config,
  (val) => {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(val))
    } catch (e) {
      console.warn('Could not persist cloud sync config.', e)
    }
  },
  { deep: true }
)

// playbooks.js registers itself once at module load, handing over the
// actual list/parse/save work (it owns the data and the XML shape) so this
// module never has to import it directly — avoids a circular import while
// still letting playbooks.js trigger an auto-save on every local change.
const registry = new Map() // key -> { loadAll(bucket, prefix), saveAll(bucket, prefix), saveOne(bucket, prefix) }

let expiryTimer = null

// Signs the person out of the app (back to the login page) when their
// short-lived Google token runs out.
function scheduleExpiry() {
  clearTimeout(expiryTimer)
  if (!state.signedIn) return
  const ms = gcs.getTokenExpiresAt() - Date.now() - 5000
  if (ms <= 0) {
    state.signedIn = false
    state.sessionExpired = true
    return
  }
  expiryTimer = setTimeout(scheduleExpiry, ms)
}
scheduleExpiry()

export function registerSyncTarget(key, { loadAll, saveAll, saveOne }) {
  registry.set(key, { loadAll, saveAll, saveOne })
}

let autoSaveTimer = null

/**
 * Called by playbooks.js after every local change. Debounces saving just
 * the *active* playbook's file if auto-sync is on and the person is signed
 * in — saving every playbook on every keystroke would be wasteful when the
 * bucket holds one file per playbook.
 */
export function scheduleAutoSave() {
  if (!state.config.autoSync || !state.signedIn || !BUCKET) return
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  autoSaveTimer = setTimeout(() => {
    Promise.all(
      Array.from(registry.values()).map((entry) =>
        entry.saveOne?.(BUCKET, OBJECT_PREFIX)
      )
    )
      .then(() => {
        state.lastSyncedAt = new Date().toISOString()
        state.lastError = ''
      })
      .catch((e) => {
        state.lastError = e.message
      })
  }, 1500)
}

async function loadFromBucketInternal() {
  state.syncing = true
  state.lastAction = 'load'
  try {
    let summary = { loadedCount: 0, errors: [] }
    for (const entry of registry.values()) {
      const result = await entry.loadAll(BUCKET, OBJECT_PREFIX)
      if (result) summary = result
    }
    state.lastSyncedAt = new Date().toISOString()
    state.lastError = summary.errors.length
      ? `Loaded ${summary.loadedCount}, but ${summary.errors.length} file(s) failed — see below.`
      : ''
    state.lastLoadSummary = summary
    return summary
  } finally {
    state.syncing = false
  }
}

async function saveToBucketInternal() {
  if (!BUCKET) return
  state.syncing = true
  state.lastAction = 'save'
  try {
    for (const entry of registry.values()) {
      await entry.saveAll(BUCKET, OBJECT_PREFIX)
    }
    state.lastSyncedAt = new Date().toISOString()
    state.lastError = ''
  } finally {
    state.syncing = false
  }
}

export function useCloudSyncStore() {
  const config = computed(() => state.config)
  const isConfigured = computed(() => !!BUCKET)
  const canWrite = computed(() => isConfigured.value && !!CLIENT_ID && state.signedIn)

  function updateConfig(patch) {
    Object.assign(state.config, patch)
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
    state.lastError = ''
    const reauthenticating = state.sessionExpired
    await gcs.requestAccessToken(CLIENT_ID)
    if (isConfigured.value) {
      try {
        await gcs.checkBucketAccess(BUCKET, OBJECT_PREFIX)
      } catch (e) {
        gcs.clearAccessToken()
        throw e
      }
    }
    state.userEmail = await gcs.fetchUserEmail()
    state.signedIn = true
    state.sessionExpired = false
    scheduleExpiry()
    // "Load all playbooks available in the bucket once the person logs in."
    if (isConfigured.value && !reauthenticating) {
      try {
        await loadFromBucketInternal()
      } catch (e) {
        // Signed in regardless; the Cloud sync page shows what went wrong.
        state.lastError = e.message
      }
    }
  }

  function disconnect() {
    gcs.clearAccessToken()
    clearTimeout(expiryTimer)
    state.signedIn = false
    state.sessionExpired = false
    state.userEmail = ''
  }

  async function loadFromBucket() {
    if (!isConfigured.value) throw new Error('No bucket configured — set the GCS_BUCKET environment variable.')
    return loadFromBucketInternal()
  }

  async function saveToBucket() {
    if (!isConfigured.value) throw new Error('No bucket configured — set the GCS_BUCKET environment variable.')
    if (!state.signedIn) throw new Error('Sign in with Google first.')
    return saveToBucketInternal()
  }

  return {
    config,
    bucket: BUCKET,
    objectPrefix: OBJECT_PREFIX,
    clientId: CLIENT_ID,
    isConfigured,
    canWrite,
    signedIn: computed(() => state.signedIn),
    sessionExpired: computed(() => state.sessionExpired),
    userEmail: computed(() => state.userEmail),
    syncing: computed(() => state.syncing),
    lastSyncedAt: computed(() => state.lastSyncedAt),
    lastError: computed(() => state.lastError),
    lastAction: computed(() => state.lastAction),
    lastLoadSummary: computed(() => state.lastLoadSummary),
    updateConfig,
    connect,
    disconnect,
    loadFromBucket,
    saveToBucket
  }
}
