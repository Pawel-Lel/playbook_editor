<script setup>
// CloudSyncView — the "Cloud sync" page (/cloud-sync): shows the configured
// bucket, the sign-in status, and buttons to load/save every playbook
// from/to Google Cloud Storage. The real work happens in store/cloudSync.js.
//
// Vue concepts: ref() for this page's own state (busy flag, messages),
// computed() for values derived from the cloudSync.
import { ref, computed } from 'vue'
import { useCloudSyncStore } from '../store/cloudSync.js'
import { usePlaybooksStore } from '../store/playbooks.js'

const cloudSync = useCloudSyncStore()
const playbooksStore = usePlaybooksStore()
const isBusy = ref(false) // true while a load/save/sign-in runs (disables the buttons)
const statusMessage = ref('')
const statusMessageKind = ref('info') // 'info' | 'error'

// Names of the required environment variables that aren't set.
// (`!x && 'NAME'` gives 'NAME' when x is empty, else false; filter(Boolean)
// then drops the false entries.)
const missingEnvironmentVariables = computed(() => [
  !cloudSync.bucket && 'GCS_BUCKET',
  !cloudSync.clientId && 'GOOGLE_OAUTH_CLIENT_ID'
].filter(Boolean))

const bucketLocation = computed(() => `gs://${cloudSync.bucket}/${cloudSync.objectPrefix}`)

const statusLabel = computed(() => {
  if (!cloudSync.bucket) return 'Not configured'
  if (!cloudSync.signedIn.value) return 'Configured, not signed in'
  return 'Signed in'
})

// "2026-09-26T10:00:00Z" → the date/time in the person's local format.
function formatTime(isoTimestamp) {
  if (!isoTimestamp) return 'never'
  try {
    return new Date(isoTimestamp).toLocaleString()
  } catch {
    return isoTimestamp
  }
}

// A one-line summary of a bucket load, e.g. "Loaded 5 playbooks ...".
function summarizeLoad(loadSummary) {
  if (!loadSummary) return ''
  const sentences = [`Loaded ${loadSummary.loadedCount} playbook${loadSummary.loadedCount === 1 ? '' : 's'} from the bucket.`]
  if (loadSummary.errors.length) {
    sentences.push(`${loadSummary.errors.length} file${loadSummary.errors.length === 1 ? '' : 's'} failed to parse: ` +
      loadSummary.errors.map((failedFile) => failedFile.name).join(', ') + '.')
  }
  return sentences.join(' ')
}

async function handleConnect() {
  isBusy.value = true
  statusMessage.value = ''
  try {
    await cloudSync.connect()
    // connect() also loads every playbook in the bucket automatically.
    statusMessage.value = cloudSync.lastLoadSummary.value
      ? summarizeLoad(cloudSync.lastLoadSummary.value)
      : 'Signed in to Google.'
    statusMessageKind.value = cloudSync.lastLoadSummary.value?.errors.length ? 'error' : 'info'
  } catch (error) {
    statusMessage.value = error.message
    statusMessageKind.value = 'error'
  } finally {
    isBusy.value = false
  }
}

function handleDisconnect() {
  cloudSync.disconnect()
  statusMessage.value = 'Signed out.'
  statusMessageKind.value = 'info'
}

async function handleLoad() {
  isBusy.value = true
  statusMessage.value = ''
  try {
    const loadSummary = await cloudSync.loadFromBucket()
    statusMessage.value = loadSummary.loadedCount
      ? summarizeLoad(loadSummary)
      : "No .xml files found at that bucket/prefix — nothing to load."
    statusMessageKind.value = loadSummary.errors.length ? 'error' : 'info'
  } catch (error) {
    statusMessage.value = error.message
    statusMessageKind.value = 'error'
  } finally {
    isBusy.value = false
  }
}

async function handleSave() {
  // Ask first: saving overwrites each playbook's existing file in the bucket.
  const playbookNameLines = playbooksStore.playbooks.value.map(
    (playbook) => `• ${playbook.playbookName || '(untitled playbook)'}`
  )
  const bucketLocationText = `gs://${cloudSync.bucket}/${cloudSync.objectPrefix || ''}`
  const userConfirmed = confirm(
    `Save all ${playbookNameLines.length} playbook(s) to ${bucketLocationText}?\n\n` +
      `${playbookNameLines.join('\n')}\n\n` +
      'Any existing file for these playbooks in the bucket will be OVERWRITTEN with the version in this ' +
      'browser. The current definitions in the bucket will be lost.\n\nDo you want to proceed?'
  )
  if (!userConfirmed) return
  isBusy.value = true
  statusMessage.value = ''
  try {
    await cloudSync.saveToBucket()
    statusMessage.value = `Saved ${playbooksStore.playbooks.value.length} playbook(s), one .xml file each, to the bucket.`
    statusMessageKind.value = 'info'
  } catch (error) {
    statusMessage.value = error.message
    statusMessageKind.value = 'error'
  } finally {
    isBusy.value = false
  }
}
</script>

<template>
  <div class="container container--narrow">
    <div class="page-head">
      <div>
        <p class="eyebrow">Data source</p>
        <h1>Cloud Storage sync</h1>
        <p class="page-sub">
          Read and write your playbooks to a Google Cloud Storage bucket instead of (or in
          addition to) this browser's local storage — one <code class="mono">.xml</code> file per
          playbook, matching how you'd browse them in the GCS console. Signing in automatically
          loads every playbook found in the bucket.
        </p>
      </div>
    </div>

    <section class="panel form-section">
      <div class="status-row">
        <span class="badge" :class="cloudSync.signedIn.value ? 'badge-terminal' : 'badge-unknown'">
          {{ statusLabel }}
        </span>
        <span class="hint">Last synced: {{ formatTime(cloudSync.lastSyncedAt.value) }}</span>
      </div>

      <h3>Bucket</h3>
      <p v-if="cloudSync.bucket" class="bucket-location mono">{{ bucketLocation }}</p>
      <p v-if="missingEnvironmentVariables.length" class="sync-message error">
        Cloud sync isn't fully configured for this deployment. Missing environment
        variable{{ missingEnvironmentVariables.length === 1 ? '' : 's' }}:
        <code class="mono">{{ missingEnvironmentVariables.join(', ') }}</code>.
      </p>
      <p class="hint">
        Every <code class="mono">.xml</code> file directly under this location is treated as one playbook — e.g.
        <code class="mono">Heating and Hot Water.xml</code>, <code class="mono">Water Taps.xml</code>. A new
        playbook created in the app is saved as <code class="mono">&lt;playbook name&gt;.xml</code> the first
        time you save it. The bucket, folder prefix and OAuth Client ID are set by the deployment
        (<code class="mono">GCS_BUCKET</code>, <code class="mono">GCS_OBJECT_PREFIX</code>,
        <code class="mono">GOOGLE_OAUTH_CLIENT_ID</code>).
      </p>
      <div class="field field--checkbox">
        <label class="checkbox-label">
          <input type="checkbox" v-model="cloudSync.config.value.autoSync" :disabled="!cloudSync.canWrite.value" />
          Auto-save the active playbook's file ~1.5s after any change (requires signing in)
        </label>
      </div>

      <div class="actions-row">
        <button v-if="!cloudSync.signedIn.value" class="btn btn-primary" :disabled="isBusy || !cloudSync.clientId" @click="handleConnect">
          Sign in with Google
        </button>
        <button v-else class="btn btn-secondary" :disabled="isBusy" @click="handleDisconnect">
          Sign out
        </button>
        <button class="btn btn-secondary" :disabled="isBusy || !cloudSync.isConfigured.value" @click="handleLoad">
          Load all playbooks from bucket
        </button>
        <button class="btn btn-primary" :disabled="isBusy || !cloudSync.canWrite.value" @click="handleSave">
          Save all playbooks to bucket
        </button>
      </div>

      <p v-if="statusMessage" class="sync-message" :class="statusMessageKind">{{ statusMessage }}</p>
      <p v-else-if="cloudSync.lastError.value" class="sync-message error">{{ cloudSync.lastError.value }}</p>

      <ul v-if="cloudSync.lastLoadSummary.value?.errors.length" class="error-list">
        <li v-for="failedFile in cloudSync.lastLoadSummary.value.errors" :key="failedFile.name">
          <span class="mono">{{ failedFile.name }}</span> — {{ failedFile.message }}
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.container--narrow {
  max-width: 800px;
}
.page-head {
  margin-bottom: 1.5rem;
}
.bucket-location {
  margin: 0 0 0.5em;
  font-size: 0.9rem;
  word-break: break-all;
}
.eyebrow {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--brand-dark);
  margin: 0 0 0.3em;
}
h1 { margin: 0 0 0.3em; }
.page-sub {
  color: var(--slate-500);
  font-size: 0.88rem;
  margin: 0;
  max-width: 60ch;
}
.form-section {
  padding: 1.4rem 1.5rem;
  margin-bottom: 1.25rem;
}
.form-section h3 {
  font-size: 0.95rem;
  color: var(--navy-800);
  margin: 1rem 0 1rem;
}
.status-row {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  margin-bottom: 0.6rem;
}
.field--checkbox {
  margin-top: 0.2rem;
}
.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5em;
  text-transform: none;
  letter-spacing: normal;
  font-weight: 400;
  font-size: 0.88rem;
  color: var(--navy-800);
}
.checkbox-label input {
  width: auto;
}
.actions-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-top: 1.2rem;
}
.sync-message {
  margin: 1rem 0 0;
  font-size: 0.86rem;
  padding: 0.6em 0.8em;
  border-radius: 4px;
  background: #eaf3ec;
  color: var(--ok);
  border: 1px solid #cfe3d3;
}
.sync-message.error {
  background: #f8ece9;
  color: var(--danger);
  border-color: #e0b3a6;
}
.error-list {
  margin: 0.6rem 0 0;
  padding-left: 1.2em;
  font-size: 0.82rem;
  color: var(--danger);
  display: flex;
  flex-direction: column;
  gap: 0.3em;
}
</style>
