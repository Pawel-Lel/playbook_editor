<script setup>
import { ref, computed } from 'vue'
import { useCloudSyncStore } from '../store/cloudSync.js'
import { usePlaybooksStore } from '../store/playbooks.js'

const store = useCloudSyncStore()
const playbooksStore = usePlaybooksStore()
const busy = ref(false)
const message = ref('')
const messageKind = ref('info') // 'info' | 'error'
const showSetupHelp = ref(false)

const missingEnv = computed(() => [
  !store.bucket && 'GCS_BUCKET',
  !store.clientId && 'GOOGLE_OAUTH_CLIENT_ID'
].filter(Boolean))

const bucketLocation = computed(() => `gs://${store.bucket}/${store.objectPrefix}`)

const statusLabel = computed(() => {
  if (!store.bucket) return 'Not configured'
  if (!store.signedIn.value) return 'Configured, not signed in'
  return 'Signed in'
})

function formatTime(iso) {
  if (!iso) return 'never'
  try {
    return new Date(iso).toLocaleString()
  } catch (e) {
    return iso
  }
}

function summarizeLoad(summary) {
  if (!summary) return ''
  const parts = [`Loaded ${summary.loadedCount} playbook${summary.loadedCount === 1 ? '' : 's'} from the bucket.`]
  if (summary.errors.length) {
    parts.push(`${summary.errors.length} file${summary.errors.length === 1 ? '' : 's'} failed to parse: ` +
      summary.errors.map((e) => e.name).join(', ') + '.')
  }
  return parts.join(' ')
}

async function handleConnect() {
  busy.value = true
  message.value = ''
  try {
    await store.connect()
    // connect() also loads every playbook in the bucket automatically.
    message.value = store.lastLoadSummary.value
      ? summarizeLoad(store.lastLoadSummary.value)
      : 'Signed in to Google.'
    messageKind.value = store.lastLoadSummary.value?.errors.length ? 'error' : 'info'
  } catch (e) {
    message.value = e.message
    messageKind.value = 'error'
  } finally {
    busy.value = false
  }
}

function handleDisconnect() {
  store.disconnect()
  message.value = 'Signed out.'
  messageKind.value = 'info'
}

async function handleLoad() {
  busy.value = true
  message.value = ''
  try {
    const summary = await store.loadFromBucket()
    message.value = summary.loadedCount
      ? summarizeLoad(summary)
      : "No .xml files found at that bucket/prefix — nothing to load."
    messageKind.value = summary.errors.length ? 'error' : 'info'
  } catch (e) {
    message.value = e.message
    messageKind.value = 'error'
  } finally {
    busy.value = false
  }
}

async function handleSave() {
  busy.value = true
  message.value = ''
  try {
    await store.saveToBucket()
    message.value = `Saved ${playbooksStore.playbooks.value.length} playbook(s), one .xml file each, to the bucket.`
    messageKind.value = 'info'
  } catch (e) {
    message.value = e.message
    messageKind.value = 'error'
  } finally {
    busy.value = false
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
        <span class="badge" :class="store.signedIn.value ? 'badge-terminal' : 'badge-unknown'">
          {{ statusLabel }}
        </span>
        <span class="hint">Last synced: {{ formatTime(store.lastSyncedAt.value) }}</span>
      </div>

      <h3>Bucket</h3>
      <p v-if="store.bucket" class="bucket-location mono">{{ bucketLocation }}</p>
      <p v-if="missingEnv.length" class="sync-message error">
        Cloud sync isn't fully configured for this deployment. Missing environment
        variable{{ missingEnv.length === 1 ? '' : 's' }}:
        <code class="mono">{{ missingEnv.join(', ') }}</code>.
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
          <input type="checkbox" v-model="store.config.value.autoSync" :disabled="!store.canWrite.value" />
          Auto-save the active playbook's file ~1.5s after any change (requires signing in)
        </label>
      </div>

      <div class="actions-row">
        <button v-if="!store.signedIn.value" class="btn btn-primary" :disabled="busy || !store.clientId" @click="handleConnect">
          Sign in with Google
        </button>
        <button v-else class="btn btn-secondary" :disabled="busy" @click="handleDisconnect">
          Sign out
        </button>
        <button class="btn btn-secondary" :disabled="busy || !store.isConfigured.value" @click="handleLoad">
          Load all playbooks from bucket
        </button>
        <button class="btn btn-primary" :disabled="busy || !store.canWrite.value" @click="handleSave">
          Save all playbooks to bucket
        </button>
      </div>

      <p v-if="message" class="sync-message" :class="messageKind">{{ message }}</p>
      <p v-else-if="store.lastError.value" class="sync-message error">{{ store.lastError.value }}</p>

      <ul v-if="store.lastLoadSummary.value?.errors.length" class="error-list">
        <li v-for="err in store.lastLoadSummary.value.errors" :key="err.name">
          <span class="mono">{{ err.name }}</span> — {{ err.message }}
        </li>
      </ul>
    </section>

    <section class="panel form-section">
      <button type="button" class="btn btn-ghost setup-toggle" @click="showSetupHelp = !showSetupHelp">
        {{ showSetupHelp ? '▾' : '▸' }} One-time Google Cloud setup
      </button>
      <div v-if="showSetupHelp" class="setup-help">
        <ol>
          <li>
            In your Google Cloud project, create (or reuse) a Cloud Storage bucket, e.g.
            <code>gsutil mb gs://my-project-boiler-flows</code>.
          </li>
          <li>
            Allow this app's origin to call the bucket over CORS:
            <pre class="mono code-block">gsutil cors set cors.json gs://my-project-boiler-flows</pre>
            with <code>cors.json</code>:
            <pre class="mono code-block">[
  {
    "origin": ["http://localhost:5173", "https://your-deployed-site.example.com"],
    "method": ["GET", "POST", "OPTIONS"],
    "responseHeader": ["Content-Type", "Authorization"],
    "maxAgeSeconds": 3600
  }
]</pre>
          </li>
          <li>
            Create an <strong>OAuth 2.0 Client ID</strong> (type: Web application) under
            "APIs &amp; Services &gt; Credentials", and add this app's origin(s) to
            "Authorized JavaScript origins".
          </li>
          <li>
            Set the deployment's environment variables: <code class="mono">GCS_BUCKET</code>,
            optionally <code class="mono">GCS_OBJECT_PREFIX</code> (e.g. <code class="mono">flows/</code>),
            and <code class="mono">GOOGLE_OAUTH_CLIENT_ID</code>.
          </li>
          <li>
            Grant the Google account you'll sign in with the
            <strong>Storage Object Admin</strong> IAM role on the bucket (or narrower
            Object Creator + Viewer roles) so it can read and write.
          </li>
          <li>
            Reads work for a <em>publicly readable</em> bucket/objects even without signing in —
            click "Load all playbooks from bucket" directly. Signing in additionally triggers
            that same load automatically. Writing always requires signing in.
          </li>
        </ol>
      </div>
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
.setup-toggle {
  font-weight: 600;
  color: var(--brand-dark);
  padding: 0;
}
.setup-help {
  margin-top: 1rem;
  font-size: 0.86rem;
  color: var(--navy-800);
}
.setup-help ol {
  padding-left: 1.2em;
  display: flex;
  flex-direction: column;
  gap: 0.8em;
}
.setup-help code {
  background: #eef0f2;
  padding: 0.1em 0.35em;
  border-radius: 3px;
  font-size: 0.82em;
}
.code-block {
  background: var(--navy-900);
  color: #d7e4ea;
  padding: 0.8em 1em;
  border-radius: 4px;
  font-size: 0.78rem;
  overflow-x: auto;
  margin: 0.5em 0;
}
</style>
