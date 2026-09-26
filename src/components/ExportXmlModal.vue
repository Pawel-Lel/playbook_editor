<script setup lang="ts">
// ExportXmlModal — pop-up showing the generated XML, with "Copy to
// clipboard" and "Download .xml". The parent passes the XML in as a prop.
import { ref } from 'vue'

const props = withDefaults(
  defineProps<{
    xml: string // required: no `?`
    filename?: string
  }>(),
  { filename: 'diagnostic-flows-export.xml' }
)
const emit = defineEmits<{ close: [] }>()

const copyState = ref<'idle' | 'copied' | 'error'>('idle')

async function copyToClipboard() {
  try {
    await navigator.clipboard.writeText(props.xml)
    copyState.value = 'copied'
  } catch {
    copyState.value = 'error'
  }
  // Reset the "Copied" message after 1.8 seconds.
  setTimeout(() => (copyState.value = 'idle'), 1800)
}

// Browsers download a file when a link with a `download` attribute is
// clicked, so: wrap the XML in a Blob, make a temporary link to it, click it.
function download(): void {
  const xmlBlob = new Blob([props.xml], { type: 'application/xml' })
  const blobUrl = URL.createObjectURL(xmlBlob)
  const downloadLink = document.createElement('a')
  downloadLink.href = blobUrl
  downloadLink.download = props.filename
  document.body.appendChild(downloadLink)
  downloadLink.click()
  document.body.removeChild(downloadLink)
  URL.revokeObjectURL(blobUrl)
}

// Close when the dark backdrop itself is clicked, not the dialog box.
function onOverlayClick(event: MouseEvent): void {
  if (event.target === event.currentTarget) emit('close')
}
</script>

<template>
  <div class="overlay" @click="onOverlayClick" @keydown.esc="$emit('close')">
    <div class="modal panel" role="dialog" aria-modal="true" aria-label="Export XML preview">
      <div class="modal__head">
        <div>
          <p class="eyebrow mono">DIAGNOSTIC_FLOWS.xml</p>
          <h2>Export preview</h2>
        </div>
        <button class="btn btn-ghost" @click="$emit('close')" aria-label="Close">✕</button>
      </div>

      <p class="modal__hint">
        Reconstructed from the active playbook's current settings and steps, in the same
        &lt;LLM_INSTRUCTIONS&gt; schema the app imports.
      </p>

      <pre class="xml-preview mono"><code>{{ xml }}</code></pre>

      <div class="modal__actions">
        <span class="copy-status" :class="copyState">
          <template v-if="copyState === 'copied'">Copied to clipboard</template>
          <template v-else-if="copyState === 'error'">Couldn't copy — select and copy manually</template>
        </span>
        <div class="modal__actions-buttons">
          <button class="btn btn-secondary" @click="copyToClipboard">Copy to clipboard</button>
          <button class="btn btn-primary" @click="download">Download .xml</button>
        </div>
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
  max-height: 86vh;
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
  font-size: 1.15rem;
}
.modal__hint {
  color: var(--slate-500);
  font-size: 0.85rem;
  margin: 0.6rem 0 1rem;
}
.xml-preview {
  flex: 1;
  overflow: auto;
  background: var(--navy-900);
  color: #d7e4ea;
  border-radius: 4px;
  padding: 1rem 1.1rem;
  font-size: 0.76rem;
  line-height: 1.55;
  white-space: pre;
  margin: 0 0 1rem;
}
.xml-preview code {
  font-family: var(--font-mono);
}
.modal__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.copy-status {
  font-size: 0.8rem;
  color: var(--slate-500);
}
.copy-status.copied { color: var(--ok); }
.copy-status.error { color: var(--danger); }
.modal__actions-buttons {
  display: flex;
  gap: 0.6rem;
  margin-left: auto;
}
</style>
