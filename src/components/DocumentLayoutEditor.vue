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

const playbookStore = usePlaybookStore()
const stepsStore = useStepsStore()

// The sections that will be exported, in order — and the ones that won't.
const exportedSections = computed(() => resolveSectionOrder(playbookStore.toExportPayload(), stepsStore.steps.value))
const omittedSections = computed(() => SECTION_KEYS.filter((sectionKey) => !exportedSections.value.includes(sectionKey)))

// Saves a new section order to the playbook.
function saveSectionOrder(newOrder) {
  playbookStore.sectionOrder.value = newOrder
}
// Swaps a section with its neighbour; direction is -1 (up) or +1 (down).
function moveSection(sectionKey, direction) {
  const newOrder = [...exportedSections.value]
  const currentIndex = newOrder.indexOf(sectionKey)
  const neighbourIndex = currentIndex + direction
  if (currentIndex === -1 || neighbourIndex < 0 || neighbourIndex >= newOrder.length) return
  // Swap two array items in one line ("destructuring assignment").
  ;[newOrder[currentIndex], newOrder[neighbourIndex]] = [newOrder[neighbourIndex], newOrder[currentIndex]]
  saveSectionOrder(newOrder)
}
function excludeSection(sectionKey) {
  saveSectionOrder(exportedSections.value.filter((otherKey) => otherKey !== sectionKey))
}
function includeSection(sectionKey) {
  saveSectionOrder([...exportedSections.value, sectionKey])
}
// The comment written above a section: its own, or the default one.
function sectionCommentText(sectionKey) {
  const storedComment = playbookStore.sectionComments.value[sectionKey]
  return storedComment === undefined || storedComment === null ? DEFAULT_SECTION_COMMENTS[sectionKey] : storedComment
}
function setSectionComment(sectionKey, commentText) {
  playbookStore.sectionComments.value[sectionKey] = commentText
}
</script>

<template>
  <section class="panel form-section">
    <h3>Document layout</h3>
    <p class="hint layout-hint">
      Top-level sections in export order, with the XML comment written above each. A section that has content is
      always exported; removing it here only drops it while it's empty.
    </p>
    <div v-for="(sectionKey, sectionIndex) in exportedSections" :key="sectionKey" class="layout-row">
      <span class="mono item-index">{{ sectionIndex + 1 }}</span>
      <span class="layout-name mono">{{ sectionKey }}</span>
      <input
        type="text"
        :value="sectionCommentText(sectionKey)"
        :placeholder="`Comment above <${sectionKey}> (blank = none)`"
        @input="setSectionComment(sectionKey, $event.target.value)"
      />
      <span class="layout-actions">
        <button type="button" class="btn btn-ghost" :disabled="sectionIndex === 0" title="Move up" @click="moveSection(sectionKey, -1)">↑</button>
        <button type="button" class="btn btn-ghost" :disabled="sectionIndex === exportedSections.length - 1" title="Move down" @click="moveSection(sectionKey, 1)">↓</button>
        <button type="button" class="btn btn-ghost" :title="`Don't export an empty ${SECTION_LABELS[sectionKey]} section`" @click="excludeSection(sectionKey)">✕</button>
      </span>
    </div>
    <div v-if="omittedSections.length" class="layout-omitted">
      <span class="hint">Not exported:</span>
      <button v-for="omittedKey in omittedSections" :key="omittedKey" type="button" class="btn btn-ghost mono" @click="includeSection(omittedKey)">+ {{ omittedKey }}</button>
    </div>
    <label class="checkbox">
      <input v-model="playbookStore.includeXmlDeclaration.value" type="checkbox" />
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
