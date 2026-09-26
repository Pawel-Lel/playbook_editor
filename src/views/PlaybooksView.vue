<script setup lang="ts">
// PlaybooksView — the "Playbook List" page (/playbooks): open .xml files,
// create, rename, duplicate, delete and switch playbooks.
//
// Vue concepts used in this file:
//  - ref(value): one reactive value; `.value` in script, unwrapped in the template.
//  - computed(() => ...): a derived value that updates automatically.
//  - Template refs: `ref="fileInputElement"` on an element in the template
//    makes the ref of the same name below hold that actual DOM element.
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { usePlaybooksStore, type OpenFilesResult } from '../store/playbooks'
import type { PlaybookRecord } from '../types'

const router = useRouter()
const playbooksStore = usePlaybooksStore()

// "New playbook" dialog
const isCreateDialogOpen = ref(false)
const newPlaybookName = ref('')
const createError = ref('')

// Inline rename: which card is being renamed, and the text typed so far.
const renamingPlaybookId = ref<string | null>(null)
const renameInputText = ref('')

// Delete is two clicks: "Delete" asks, "Confirm delete" does it.
const playbookIdAwaitingDeleteConfirm = ref<string | null>(null)

// "Open files…"
const fileInputElement = ref<HTMLInputElement | null>(null) // the hidden <input type="file"> (template ref)
const isLoadingFiles = ref(false)
const openFilesResult = ref<OpenFilesResult | null>(null)
const openFilesError = ref('')

// The visible button just clicks the hidden file input, which opens the
// browser's file picker.
function pickLocalFiles(): void {
  fileInputElement.value.click()
}

// Runs when the person has chosen files in the picker.
async function onFilesPicked(event: Event): Promise<void> {
  const fileInput = event.target as HTMLInputElement // the event came from the <input>
  const pickedFiles = Array.from(fileInput.files || [])
  fileInput.value = '' // so picking the same files again still fires change
  if (!pickedFiles.length) return
  isLoadingFiles.value = true
  openFilesError.value = ''
  openFilesResult.value = null
  try {
    // Read every file's text (in parallel), then hand them all to the store.
    const filesWithText = await Promise.all(
      pickedFiles.map(async (pickedFile) => ({ name: pickedFile.name, text: await pickedFile.text() }))
    )
    const result = playbooksStore.openLocalFiles(filesWithText, {
      confirmReplace: (fileNames) =>
        confirm(`These playbooks are already loaded and will be overwritten (unsaved changes lost):\n\n${fileNames.join('\n')}\n\nContinue?`)
    })
    if (!result.cancelled) openFilesResult.value = result
  } catch (error) {
    openFilesError.value = error.message
  } finally {
    isLoadingFiles.value = false
  }
}

// Playbooks in alphabetical order. [...list] copies the list first, since
// sort() would otherwise reorder the store's own array.
const sortedPlaybooks = computed(() =>
  [...playbooksStore.playbooks.value].sort((first, second) => first.playbookName.localeCompare(second.playbookName))
)

function openCreateDialog(): void {
  isCreateDialogOpen.value = true
  newPlaybookName.value = ''
  createError.value = ''
}

function submitCreate(): PlaybookRecord | undefined {
  try {
    const createdPlaybook = playbooksStore.createPlaybook(newPlaybookName.value)
    isCreateDialogOpen.value = false
    router.push('/steps')
    return createdPlaybook
  } catch (error) {
    createError.value = error.message
  }
}

function switchToPlaybook(playbookId: string): void {
  playbooksStore.setActivePlaybookId(playbookId)
  router.push('/steps')
}

function startRename(playbook: PlaybookRecord): void {
  renamingPlaybookId.value = playbook.id
  renameInputText.value = playbook.playbookName
}
function cancelRename(): void {
  renamingPlaybookId.value = null
}
function submitRename(playbookId: string): void {
  try {
    playbooksStore.renamePlaybook(playbookId, renameInputText.value)
    renamingPlaybookId.value = null
  } catch {
    // keep the row open with the input so they can fix it
  }
}

function duplicatePlaybook(playbookId: string): void {
  playbooksStore.duplicatePlaybook(playbookId)
}

function askDelete(playbookId: string): void {
  playbookIdAwaitingDeleteConfirm.value = playbookId
}
function cancelDelete(): void {
  playbookIdAwaitingDeleteConfirm.value = null
}
function confirmDelete(playbookId: string): void {
  try {
    playbooksStore.deletePlaybook(playbookId)
  } finally {
    playbookIdAwaitingDeleteConfirm.value = null
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
          :disabled="isLoadingFiles"
          title="Load one or more playbook .xml files from this computer"
          @click="pickLocalFiles"
        >
          {{ isLoadingFiles ? 'Loading…' : 'Open files…' }}
        </button>
        <!-- Hidden; opened by the button above. `multiple` allows picking several files. -->
        <input
          ref="fileInputElement"
          type="file"
          accept=".xml,application/xml,text/xml"
          multiple
          hidden
          @change="onFilesPicked"
        />
        <button class="btn btn-primary" @click="openCreateDialog">+ New playbook</button>
      </div>
    </div>

    <!-- Result of "Open files…": what was added/updated, and any files that failed. -->
    <p v-if="openFilesError" class="form-error">{{ openFilesError }}</p>
    <div v-if="openFilesResult" class="files-result" :class="{ 'has-errors': openFilesResult.errors.length }">
      <template v-if="openFilesResult.added || openFilesResult.updated">
        <template v-if="openFilesResult.added">
          Added {{ openFilesResult.added }} playbook{{ openFilesResult.added === 1 ? '' : 's' }}.
        </template>
        <template v-if="openFilesResult.updated">
          Updated {{ openFilesResult.updated }} existing playbook{{ openFilesResult.updated === 1 ? '' : 's' }}.
        </template>
      </template>
      <template v-else>No playbooks loaded — nothing was changed.</template>
      <ul v-if="openFilesResult.errors.length">
        <li v-for="fileError in openFilesResult.errors" :key="fileError.name">
          <span class="mono">{{ fileError.name }}</span>: {{ fileError.message }}
        </li>
      </ul>
    </div>

    <!-- One card per playbook. -->
    <ul class="playbook-list">
      <li
        v-for="playbook in sortedPlaybooks"
        :key="playbook.id"
        class="playbook-card panel"
        :class="{ 'is-active': playbook.id === playbooksStore.activePlaybookId.value }"
      >
        <div class="playbook-card__main">
          <div class="playbook-card__head">
            <span v-if="playbook.id === playbooksStore.activePlaybookId.value" class="badge badge-terminal">Active</span>
            <span class="mono playbook-card__id">{{ playbook.id }}</span>
          </div>

          <!-- While renaming, the name turns into a text box.
               @keyup.enter / @keyup.esc react to those specific keys. -->
          <template v-if="renamingPlaybookId === playbook.id">
            <div class="rename-row">
              <input v-model="renameInputText" type="text" @keyup.enter="submitRename(playbook.id)" @keyup.esc="cancelRename" />
              <button class="btn btn-secondary" @click="submitRename(playbook.id)">Save</button>
              <button class="btn btn-ghost" @click="cancelRename">Cancel</button>
            </div>
          </template>
          <h3 v-else class="playbook-card__name">{{ playbook.playbookName || '(untitled playbook)' }}</h3>

          <p class="playbook-card__meta">
            {{ playbook.steps.length }} step{{ playbook.steps.length === 1 ? '' : 's' }} ·
            {{ playbook.guidelines.length }} guideline{{ playbook.guidelines.length === 1 ? '' : 's' }} ·
            {{ playbook.escalations.length }} escalation{{ playbook.escalations.length === 1 ? '' : 's' }}
          </p>
        </div>

        <div class="playbook-card__actions">
          <button
            v-if="playbook.id !== playbooksStore.activePlaybookId.value"
            class="btn btn-primary"
            @click="switchToPlaybook(playbook.id)"
          >
            Switch to this playbook
          </button>
          <button v-else class="btn btn-secondary" disabled>Currently active</button>
          <button class="btn btn-ghost" @click="startRename(playbook)">Rename</button>
          <button class="btn btn-ghost" @click="duplicatePlaybook(playbook.id)">Duplicate</button>
          <template v-if="playbookIdAwaitingDeleteConfirm === playbook.id">
            <button class="btn btn-danger" :disabled="playbooksStore.playbooks.value.length <= 1" @click="confirmDelete(playbook.id)">
              Confirm delete
            </button>
            <button class="btn btn-ghost" @click="cancelDelete">Cancel</button>
          </template>
          <button
            v-else
            class="btn btn-ghost"
            :disabled="playbooksStore.playbooks.value.length <= 1"
            :title="playbooksStore.playbooks.value.length <= 1 ? 'At least one playbook must remain' : ''"
            @click="askDelete(playbook.id)"
          >
            Delete
          </button>
        </div>
      </li>
    </ul>

    <!-- "New playbook" dialog. @click.self closes it only when the dark
         backdrop itself is clicked, not the dialog box inside it. -->
    <div v-if="isCreateDialogOpen" class="overlay" @click.self="isCreateDialogOpen = false">
      <div class="modal panel">
        <h2>New playbook</h2>
        <p class="hint">Starts empty — add steps and settings for it once created.</p>
        <div class="field">
          <label for="newPlaybookName">Playbook name</label>
          <input
            id="newPlaybookName"
            v-model="newPlaybookName"
            type="text"
            placeholder="e.g. Electrical Appliance Diagnosis"
            @keyup.enter="submitCreate"
          />
        </div>
        <p v-if="createError" class="form-error">{{ createError }}</p>
        <div class="modal__actions">
          <button class="btn btn-secondary" @click="isCreateDialogOpen = false">Cancel</button>
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
