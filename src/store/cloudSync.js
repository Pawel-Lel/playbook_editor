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
  signedIn: false,
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

  async function connect() {
    state.lastError = ''
    await gcs.requestAccessToken(CLIENT_ID, { prompt: 'consent' })
    state.signedIn = true
    // "Load all playbooks available in the bucket once the person logs in."
    if (isConfigured.value) {
      await loadFromBucketInternal()
    }
  }

  function disconnect() {
    gcs.clearAccessToken()
    state.signedIn = false
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
