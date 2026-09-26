<script setup>
import { ref, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useStepsStore } from '../store/steps.js'
import { usePlaybookStore } from '../store/playbook.js'
import { buildLlmInstructionsXml, exportFileName } from '../utils/xmlExport.js'
import ExportXmlModal from '../components/ExportXmlModal.vue'

const store = useStepsStore()
const playbook = usePlaybookStore()
const search = ref('')
const confirmingId = ref(null)
const showExport = ref(false)

const exportedXml = computed(() =>
  buildLlmInstructionsXml(
    playbook.toExportPayload(),
    store.steps.value
  )
)

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return store.steps.value
  return store.steps.value.filter((s) =>
    s.id.toLowerCase().includes(q) ||
    s.topic.toLowerCase().includes(q) ||
    s.issueSummary.toLowerCase().includes(q)
  )
})

function askDelete(id) {
  confirmingId.value = id
}
function cancelDelete() {
  confirmingId.value = null
}
function confirmDelete(id) {
  store.deleteStep(id)
  confirmingId.value = null
}

function clearAllSteps() {
  if (confirm('Remove every step from this playbook? This cannot be undone.')) {
    store.clearSteps()
  }
}
</script>

<template>
  <div class="container">
    <div class="page-head">
      <div>
        <p class="eyebrow mono">{{ playbook.playbookName.value || '(untitled playbook)' }}</p>
        <h1>Diagnostic steps</h1>
        <p class="page-sub">
          {{ store.steps.value.length }} step{{ store.steps.value.length === 1 ? '' : 's' }} in this playbook.
        </p>
      </div>
      <div class="page-head__actions">
        <button class="btn btn-secondary" @click="clearAllSteps">Clear all steps</button>
        <button class="btn btn-secondary" @click="showExport = true">Export XML</button>
        <RouterLink to="/steps/new" class="btn btn-primary">+ New step</RouterLink>
      </div>
    </div>

    <div class="toolbar">
      <input
        v-model="search"
        type="search"
        placeholder="Search by ID, topic or issue summary…"
        aria-label="Search steps"
      />
      <RouterLink to="/flow-map" class="btn btn-secondary">View flow map →</RouterLink>
    </div>

    <div v-if="filtered.length === 0" class="empty-state panel">
      <p>No steps match "{{ search }}".</p>
    </div>

    <ul class="step-list">
      <li v-for="step in filtered" :key="step.id" class="step-card panel">
        <div class="step-card__main">
          <div class="step-card__id mono">{{ step.id }}</div>
          <h3 class="step-card__topic">{{ step.topic || '(no topic set)' }}</h3>
          <p v-if="step.comment" class="step-card__comment mono" :title="step.comment">
            <!-- {{ step.comment.split('\n')[0] }}{{ step.comment.includes('\n') ? ' …' : '' }} -->
          </p>
          <p class="step-card__summary">{{ step.issueSummary || 'No issue summary provided.' }}</p>
          <div class="step-card__targets">
            <span
              v-for="c in step.classifications"
              :key="c.id"
              class="target-chip mono"
              :title="c.triggerCondition"
            >
              {{ c.classificationId || '—' }} → {{ c.nextStep || '?' }}
            </span>
          </div>
        </div>
        <div class="step-card__actions">
          <RouterLink :to="`/steps/${encodeURIComponent(step.id)}`" class="btn btn-secondary">Edit</RouterLink>
          <template v-if="confirmingId === step.id">
            <button class="btn btn-danger" @click="confirmDelete(step.id)">Confirm delete</button>
            <button class="btn btn-ghost" @click="cancelDelete">Cancel</button>
          </template>
          <button v-else class="btn btn-ghost" @click="askDelete(step.id)">Delete</button>
        </div>
      </li>
    </ul>

    <ExportXmlModal
      v-if="showExport"
      :xml="exportedXml"
      :filename="exportFileName(playbook.playbookName.value)"
      @close="showExport = false"
    />
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
.page-sub {
  color: var(--slate-500);
  font-size: 0.88rem;
  margin: 0;
}
.eyebrow {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--brand-dark);
  margin: 0 0 0.3em;
}
.page-head__actions {
  display: flex;
  gap: 0.6rem;
}
.toolbar {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}
.toolbar input {
  max-width: 420px;
}
.empty-state {
  padding: 2rem;
  text-align: center;
  color: var(--slate-500);
}
.step-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
.step-card {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1.5rem;
  padding: 1.2rem 1.4rem;
}
.step-card__id {
  font-size: 0.75rem;
  color: var(--brand-dark);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 0.3em;
}
.step-card__topic {
  margin: 0 0 0.35em;
  font-size: 1.05rem;
}
.step-card__summary {
  margin: 0 0 0.7em;
  color: var(--slate-500);
  font-size: 0.88rem;
  max-width: 62ch;
}
.step-card__comment {
  margin: 0 0 0.5em;
  color: var(--ok);
  font-style: italic;
  font-size: 0.78rem;
  max-width: 62ch;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.step-card__targets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.target-chip {
  font-size: 0.7rem;
  background: #edeff2;
  color: var(--brand-dark);
  border: 1px solid #d5d9de;
  padding: 0.2em 0.5em;
  border-radius: 3px;
}
.step-card__actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}
</style>
