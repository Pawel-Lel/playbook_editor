<script setup>
// Edits how the playbook is laid out as an XML document: which top-level
// sections are written and in what order, the <!-- ... --> comment above
// each one, and whether the file starts with an <?xml ...?> declaration.
// Imported files remember all three (Triage.xml: no declaration,
// ESCALATION_HANDLING before CLARIFICATION_RULES, "STEP 1: ..." comments).
import { computed } from 'vue'
import { usePlaybookStore } from '../store/playbook.js'
import { useStepsStore } from '../store/steps.js'
import { SECTION_KEYS, SECTION_LABELS, DEFAULT_SECTION_COMMENTS, resolveSectionOrder } from '../utils/xmlExport.js'

const playbook = usePlaybookStore()
const stepsStore = useStepsStore()

const order = computed(() => resolveSectionOrder(playbook.toExportPayload(), stepsStore.steps.value))
const omitted = computed(() => SECTION_KEYS.filter((k) => !order.value.includes(k)))

function commit(next) {
  playbook.sectionOrder.value = next
}
function move(key, delta) {
  const next = [...order.value]
  const i = next.indexOf(key)
  const j = i + delta
  if (i === -1 || j < 0 || j >= next.length) return
  ;[next[i], next[j]] = [next[j], next[i]]
  commit(next)
}
function exclude(key) {
  commit(order.value.filter((k) => k !== key))
}
function include(key) {
  commit([...order.value, key])
}
function commentValue(key) {
  const stored = playbook.sectionComments.value[key]
  return stored === undefined || stored === null ? DEFAULT_SECTION_COMMENTS[key] : stored
}
function setComment(key, value) {
  playbook.sectionComments.value[key] = value
}
</script>

<template>
  <section class="panel form-section">
    <h3>Document layout</h3>
    <p class="hint layout-hint">
      Top-level sections in export order, with the XML comment written above each. A section that has content is
      always exported; removing it here only drops it while it's empty.
    </p>
    <div v-for="(key, idx) in order" :key="key" class="layout-row">
      <span class="mono item-index">{{ idx + 1 }}</span>
      <span class="layout-name mono">{{ key }}</span>
      <input
        type="text"
        :value="commentValue(key)"
        :placeholder="`Comment above <${key}> (blank = none)`"
        @input="setComment(key, $event.target.value)"
      />
      <span class="layout-actions">
        <button type="button" class="btn btn-ghost" :disabled="idx === 0" title="Move up" @click="move(key, -1)">↑</button>
        <button type="button" class="btn btn-ghost" :disabled="idx === order.length - 1" title="Move down" @click="move(key, 1)">↓</button>
        <button type="button" class="btn btn-ghost" :title="`Don't export an empty ${SECTION_LABELS[key]} section`" @click="exclude(key)">✕</button>
      </span>
    </div>
    <div v-if="omitted.length" class="layout-omitted">
      <span class="hint">Not exported:</span>
      <button v-for="key in omitted" :key="key" type="button" class="btn btn-ghost mono" @click="include(key)">+ {{ key }}</button>
    </div>
    <label class="checkbox">
      <input v-model="playbook.includeXmlDeclaration.value" type="checkbox" />
      Start the file with <code>&lt;?xml version="1.0" encoding="UTF-8"?&gt;</code>
    </label>
  </section>
</template>

<style scoped>
.layout-hint { margin: -0.5rem 0 1rem; }
.layout-row {
  display: grid;
  grid-template-columns: 1.5rem 13rem 1fr auto;
  gap: 0.6rem;
  align-items: center;
  margin-bottom: 0.5rem;
}
.layout-name { font-size: 0.8rem; color: var(--navy-800); }
.layout-actions { display: flex; gap: 0.1rem; }
.layout-omitted { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3rem; margin: 0.4rem 0 0.8rem; }
.layout-omitted .hint { margin: 0; }
.checkbox {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  text-transform: none;
  letter-spacing: normal;
  font-weight: 400;
  margin-top: 0.6rem;
}
@media (max-width: 720px) {
  .layout-row { grid-template-columns: 1fr; }
}
</style>
