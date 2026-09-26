<script setup lang="ts">
// ImportXmlModal — pop-up for pasting or uploading XML that replaces the
// active playbook's content in place (new playbooks come from the
// Playbooks page's "Open files…" instead). It doesn't import anything
// itself: it emits 'imported' with the XML text and the parent does the rest.
//
// Vue concepts: defineProps (inputs from the parent), defineEmits (events
// sent to the parent — listened to there as @imported / @close), ref().
import { ref } from 'vue'

// Props are used directly in the template (activePlaybookName, errorMessage),
// so the return value of defineProps isn't needed here.
withDefaults(
  defineProps<{
    activePlaybookName?: string
    // Set by the parent after a failed import attempt (e.g. invalid XML) —
    // shown alongside this modal's own "paste something first" validation.
    errorMessage?: string
  }>(),
  { activePlaybookName: '', errorMessage: '' }
)
const emit = defineEmits<{
  close: []
  imported: [xmlText: string]
}>()

const xmlText = ref('') // bound to the textarea with v-model
const chosenFileName = ref('')
const localError = ref('')

// Reads the chosen file into the textarea. FileReader works with
// callbacks: onload runs once the file has been read.
function onFileChange(event: Event): void {
  // `as HTMLInputElement`: tells TypeScript the event came from an <input>.
  const chosenFile = (event.target as HTMLInputElement).files?.[0]
  if (!chosenFile) return
  chosenFileName.value = chosenFile.name
  localError.value = ''
  const fileReader = new FileReader()
  fileReader.onload = () => {
    xmlText.value = String(fileReader.result || '')
  }
  fileReader.onerror = () => {
    localError.value = 'Could not read that file.'
  }
  fileReader.readAsText(chosenFile)
}

function handleImport() {
  if (!xmlText.value.trim()) {
    localError.value = 'Paste or choose an XML file first.'
    return
  }
  localError.value = ''
  emit('imported', xmlText.value)
}

// Close when the dark backdrop itself is clicked (event.target), but not
// when the click lands inside the dialog box.
function onOverlayClick(event: MouseEvent): void {
  if (event.target === event.currentTarget) emit('close')
}
</script>

<template>
  <div class="overlay" @click="onOverlayClick" @keydown.esc="$emit('close')">
    <div class="modal panel" role="dialog" aria-modal="true" aria-label="Import XML">
      <div class="modal__head">
        <div>
          <p class="eyebrow mono">LLM_INSTRUCTIONS.xml</p>
          <h2>Import XML (replace this playbook)</h2>
        </div>
        <button class="btn btn-ghost" @click="$emit('close')" aria-label="Close">✕</button>
      </div>

      <p class="modal__hint">
        Works fully offline — no Google sign-in or bucket needed. Paste an
        <code>&lt;LLM_INSTRUCTIONS&gt;</code> (or bare <code>&lt;DIAGNOSTIC_FLOWS&gt;</code>) document below, or
        choose a <code>.xml</code> file, then Import.
        This <strong>replaces every field</strong> of "{{ activePlaybookName || 'the active playbook' }}"
        — steps, guidelines, escalations, routing logic, everything — with what's parsed from the XML below.
      </p>

      <div class="upload-row">
        <label class="btn btn-secondary file-btn">
          Choose .xml file…
          <input type="file" accept=".xml,application/xml,text/xml" @change="onFileChange" />
        </label>
        <span v-if="chosenFileName" class="file-name mono">{{ chosenFileName }}</span>
      </div>

      <textarea
        v-model="xmlText"
        class="xml-input mono"
        rows="16"
        placeholder="<LLM_INSTRUCTIONS> ... </LLM_INSTRUCTIONS>"
      ></textarea>

      <p v-if="localError || errorMessage" class="import-error">{{ localError || errorMessage }}</p>

      <div class="modal__actions">
        <button class="btn btn-secondary" @click="$emit('close')">Cancel</button>
        <button class="btn btn-primary" @click="handleImport">
          Import and replace
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
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
  width: min(880px, 100%);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  padding: 1.5rem 1.6rem;
}
.modal__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}
.eyebrow {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--brand-dark);
  margin: 0 0 0.25em;
}
.modal__head h2 {
  margin: 0;
  font-size: 1.1rem;
}
.modal__hint {
  color: var(--slate-500);
  font-size: 0.85rem;
  margin: 0.6rem 0 1rem;
  line-height: 1.5;
}
.modal__hint code {
  background: #eef0f2;
  padding: 0.1em 0.35em;
  border-radius: 3px;
  font-size: 0.9em;
}
.upload-row {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  margin-bottom: 0.8rem;
}
.file-btn {
  position: relative;
  overflow: hidden;
}
.file-btn input[type='file'] {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
  width: 100%;
}
.file-name {
  font-size: 0.8rem;
  color: var(--slate-500);
}
.xml-input {
  flex: 1;
  min-height: 260px;
  font-size: 0.78rem;
  line-height: 1.5;
  resize: vertical;
}
.import-error {
  background: #f8ece9;
  border: 1px solid #e0b3a6;
  color: var(--danger);
  padding: 0.6em 0.9em;
  border-radius: 4px;
  font-size: 0.85rem;
  margin: 0.8rem 0 0;
}
.modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  margin-top: 1.1rem;
}
</style>
