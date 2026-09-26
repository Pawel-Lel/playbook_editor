<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { usePlaybooksStore } from '../store/playbooks.js'

const router = useRouter()
const store = usePlaybooksStore()

const showCreate = ref(false)
const newName = ref('')
const createError = ref('')

const renamingId = ref(null)
const renameValue = ref('')

const confirmingDeleteId = ref(null)

const fileInput = ref(null)
const filesLoading = ref(false)
const filesResult = ref(null) // { added, updated, errors } | null
const filesError = ref('')

function pickLocalFiles() {
  fileInput.value.click()
}

async function onFilesPicked(event) {
  const picked = Array.from(event.target.files || [])
  event.target.value = '' // so picking the same files again still fires change
  if (!picked.length) return
  filesLoading.value = true
  filesError.value = ''
  filesResult.value = null
  try {
    const files = await Promise.all(picked.map(async (f) => ({ name: f.name, text: await f.text() })))
    const result = store.openLocalFiles(files, {
      confirmReplace: (names) =>
        confirm(`These playbooks are already loaded and will be overwritten (unsaved changes lost):\n\n${names.join('\n')}\n\nContinue?`)
    })
    if (!result.cancelled) filesResult.value = result
  } catch (e) {
    filesError.value = e.message
  } finally {
    filesLoading.value = false
  }
}

const sortedPlaybooks = computed(() =>
  [...store.playbooks.value].sort((a, b) => a.playbookName.localeCompare(b.playbookName))
)

function stepCount(playbook) {
  return playbook.steps.length
}

function openCreate() {
  showCreate.value = true
  newName.value = ''
  createError.value = ''
}

function submitCreate() {
  try {
    const record = store.createPlaybook(newName.value)
    showCreate.value = false
    router.push('/steps')
    return record
  } catch (e) {
    createError.value = e.message
  }
}


function switchTo(id) {
  store.setActivePlaybookId(id)
  router.push('/steps')
}

function startRename(playbook) {
  renamingId.value = playbook.id
  renameValue.value = playbook.playbookName
}
function cancelRename() {
  renamingId.value = null
}
function submitRename(id) {
  try {
    store.renamePlaybook(id, renameValue.value)
    renamingId.value = null
  } catch (e) {
    // keep the row open with the input so they can fix it
  }
}

function duplicate(id) {
  store.duplicatePlaybook(id)
}

function askDelete(id) {
  confirmingDeleteId.value = id
}
function cancelDelete() {
  confirmingDeleteId.value = null
}
function confirmDelete(id) {
  try {
    store.deletePlaybook(id)
  } finally {
    confirmingDeleteId.value = null
  }
}
</script>

<template>
  <div class="container">
    <div class="page-head">
      <div>
        <h1>Playbooks</h1>
        <p class="page-sub">
          Each playbook has its own setup, guidelines, escalation rules and set of diagnostic
          steps. The Steps list, Flow map and Playbook settings pages always show the active one.
          Load playbooks from a Google Cloud Storage bucket on the
          <RouterLink to="/cloud-sync">Cloud sync</RouterLink> page, or open one or more <span class="mono">.xml</span> files from this computer.
        </p>
      </div>
      <div class="page-head__actions">
        <button
          class="btn btn-secondary"
          :disabled="filesLoading"
          title="Load one or more playbook .xml files from this computer"
          @click="pickLocalFiles"
        >
          {{ filesLoading ? 'Loading…' : 'Open files…' }}
        </button>
        <input
          ref="fileInput"
          type="file"
          accept=".xml,application/xml,text/xml"
          multiple
          hidden
          @change="onFilesPicked"
        />
        <button class="btn btn-primary" @click="openCreate">+ New playbook</button>
      </div>
    </div>

    <p v-if="filesError" class="form-error">{{ filesError }}</p>
    <div v-if="filesResult" class="files-result" :class="{ 'has-errors': filesResult.errors.length }">
      <template v-if="filesResult.added || filesResult.updated">
        <template v-if="filesResult.added">
          Added {{ filesResult.added }} playbook{{ filesResult.added === 1 ? '' : 's' }}.
        </template>
        <template v-if="filesResult.updated">
          Updated {{ filesResult.updated }} existing playbook{{ filesResult.updated === 1 ? '' : 's' }}.
        </template>
      </template>
      <template v-else>No playbooks loaded — nothing was changed.</template>
      <ul v-if="filesResult.errors.length">
        <li v-for="err in filesResult.errors" :key="err.name">
          <span class="mono">{{ err.name }}</span>: {{ err.message }}
        </li>
      </ul>
    </div>

    <ul class="playbook-list">
      <li
        v-for="p in sortedPlaybooks"
        :key="p.id"
        class="playbook-card panel"
        :class="{ 'is-active': p.id === store.activePlaybookId.value }"
      >
        <div class="playbook-card__main">
          <div class="playbook-card__head">
            <span v-if="p.id === store.activePlaybookId.value" class="badge badge-terminal">Active</span>
            <span class="mono playbook-card__id">{{ p.id }}</span>
          </div>

          <template v-if="renamingId === p.id">
            <div class="rename-row">
              <input v-model="renameValue" type="text" @keyup.enter="submitRename(p.id)" @keyup.esc="cancelRename" />
              <button class="btn btn-secondary" @click="submitRename(p.id)">Save</button>
              <button class="btn btn-ghost" @click="cancelRename">Cancel</button>
            </div>
          </template>
          <h3 v-else class="playbook-card__name">{{ p.playbookName || '(untitled playbook)' }}</h3>

          <p class="playbook-card__meta">
            {{ stepCount(p) }} step{{ stepCount(p) === 1 ? '' : 's' }} ·
            {{ p.guidelines.length }} guideline{{ p.guidelines.length === 1 ? '' : 's' }} ·
            {{ p.escalations.length }} escalation{{ p.escalations.length === 1 ? '' : 's' }}
          </p>
        </div>

        <div class="playbook-card__actions">
          <button
            v-if="p.id !== store.activePlaybookId.value"
            class="btn btn-primary"
            @click="switchTo(p.id)"
          >
            Switch to this playbook
          </button>
          <button v-else class="btn btn-secondary" disabled>Currently active</button>
          <button class="btn btn-ghost" @click="startRename(p)">Rename</button>
          <button class="btn btn-ghost" @click="duplicate(p.id)">Duplicate</button>
          <template v-if="confirmingDeleteId === p.id">
            <button class="btn btn-danger" :disabled="store.playbooks.value.length <= 1" @click="confirmDelete(p.id)">
              Confirm delete
            </button>
            <button class="btn btn-ghost" @click="cancelDelete">Cancel</button>
          </template>
          <button
            v-else
            class="btn btn-ghost"
            :disabled="store.playbooks.value.length <= 1"
            :title="store.playbooks.value.length <= 1 ? 'At least one playbook must remain' : ''"
            @click="askDelete(p.id)"
          >
            Delete
          </button>
        </div>
      </li>
    </ul>

    <div v-if="showCreate" class="overlay" @click.self="showCreate = false">
      <div class="modal panel">
        <h2>New playbook</h2>
        <p class="hint">Starts empty — add steps and settings for it once created.</p>
        <div class="field">
          <label for="newPlaybookName">Playbook name</label>
          <input
            id="newPlaybookName"
            v-model="newName"
            type="text"
            placeholder="e.g. Electrical Appliance Diagnosis"
            @keyup.enter="submitCreate"
          />
        </div>
        <p v-if="createError" class="form-error">{{ createError }}</p>
        <div class="modal__actions">
          <button class="btn btn-secondary" @click="showCreate = false">Cancel</button>
          <button class="btn btn-primary" @click="submitCreate">Create playbook</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
}
.page-head__actions {
  display: flex;
  gap: 0.6rem;
  flex-shrink: 0;
}
.page-sub {
  color: var(--slate-500);
  font-size: 0.88rem;
  max-width: 62ch;
  margin: 0;
}
.playbook-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
.playbook-card {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1.5rem;
  padding: 1.2rem 1.4rem;
}
.playbook-card.is-active {
  border-color: var(--brand);
  box-shadow: 0 0 0 1px var(--brand) inset;
}
.playbook-card__head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.4rem;
}
.playbook-card__id {
  font-size: 0.72rem;
  color: var(--slate-500);
}
.playbook-card__name {
  margin: 0 0 0.3em;
  font-size: 1.1rem;
}
.playbook-card__meta {
  margin: 0;
  color: var(--slate-500);
  font-size: 0.84rem;
}
.playbook-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  flex-shrink: 0;
  max-width: 260px;
  justify-content: flex-end;
}
.rename-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 0.4rem;
}
.rename-row input {
  max-width: 280px;
}
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(13, 32, 51, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  z-index: 40;
}
.modal {
  width: min(440px, 100%);
  padding: 1.5rem 1.6rem;
}
.modal h2 {
  margin: 0 0 0.3em;
  font-size: 1.1rem;
}
.modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  margin-top: 1.2rem;
}
.files-result {
  background: #eaf3ec;
  border: 1px solid #cfe3d3;
  color: var(--ok);
  padding: 0.6em 0.9em;
  border-radius: 4px;
  font-size: 0.85rem;
  margin-bottom: 1rem;
}
.files-result.has-errors {
  background: #f8ece9;
  border-color: #e0b3a6;
  color: var(--danger);
}
.files-result ul {
  margin: 0.4em 0 0;
  padding-left: 1.2em;
}
.form-error {
  background: #f8ece9;
  border: 1px solid #e0b3a6;
  color: var(--danger);
  padding: 0.6em 0.9em;
  border-radius: 4px;
  font-size: 0.85rem;
  margin-top: 0.5rem;
}
</style>
