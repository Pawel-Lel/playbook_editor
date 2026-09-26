<script setup>
import { ref } from 'vue'

const props = defineProps({
  xml: { type: String, required: true },
  filename: { type: String, default: 'diagnostic-flows-export.xml' }
})
const emit = defineEmits(['close'])

const copyState = ref('idle') // 'idle' | 'copied' | 'error'

async function copyToClipboard() {
  try {
    await navigator.clipboard.writeText(props.xml)
    copyState.value = 'copied'
  } catch (e) {
    copyState.value = 'error'
  }
  setTimeout(() => (copyState.value = 'idle'), 1800)
}

function download() {
  const blob = new Blob([props.xml], { type: 'application/xml' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = props.filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function onOverlayClick(e) {
  if (e.target === e.currentTarget) emit('close')
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
