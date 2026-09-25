<script setup>
import { reactive, watch, computed } from 'vue'

const props = defineProps({
  initial: { type: Object, default: null },
  mode: { type: String, default: 'create' }, // 'create' | 'edit'
  allTargets: { type: Array, default: () => [] }, // [{id, kind, label}]
  errorMessage: { type: String, default: '' }
})

const emit = defineEmits(['submit', 'cancel', 'delete'])

const PROMPT_TYPES = ['InitialQuery', 'ConfirmationQuery', 'InternalProcessing']
const ACTION_TYPES = ['Flow_Invocation', 'RAG_Retrieval', 'Tool_Invocation', 'Internal_State_Update']

function blankAction() {
  return {
    id: `tmpa_${Math.random().toString(36).slice(2, 9)}`,
    toolType: '',
    toolId: '',
    flowId: '',
    parameterName: '',
    parameterValue: ''
  }
}

function blankClassification() {
  return {
    id: `tmp_${Math.random().toString(36).slice(2, 9)}`,
    classificationId: '',
    nextStep: '',
    triggerCondition: '',
    query: '',
    dialogResponse: '',
    comment: '',
    actions: []
  }
}

function makeFormState(source) {
  return reactive({
    id: source?.id || '',
    topic: source?.topic || '',
    issueSummary: source?.issueSummary || '',
    instructions: source?.instructions || '',
    comment: source?.comment || '',
    promptType: source?.promptType || 'InitialQuery',
    promptComment: source?.promptComment || '',
    prompt: source?.prompt || '',
    noMatchResponse: source?.noMatchResponse || '',
    noInputResponse: source?.noInputResponse || '',
    classifications: source?.classifications?.length
      ? source.classifications.map((c) => ({
          ...c,
          actions: (c.actions || []).map((a) => ({ ...a }))
        }))
      : [blankClassification()]
  })
}

const form = makeFormState(props.initial)

watch(
  () => props.initial,
  (val) => {
    Object.assign(form, makeFormState(val))
  }
)

function addClassification() {
  form.classifications.push(blankClassification())
}
function removeClassification(idx) {
  form.classifications.splice(idx, 1)
  if (form.classifications.length === 0) form.classifications.push(blankClassification())
}
function addAction(classification) {
  classification.actions.push(blankAction())
}
function removeAction(classification, idx) {
  classification.actions.splice(idx, 1)
}

const targetOptions = computed(() => props.allTargets)

function handleSubmit() {
  emit('submit', JSON.parse(JSON.stringify(form)))
}
</script>

<template>
  <form class="step-form" @submit.prevent="handleSubmit">
    <div v-if="errorMessage" class="form-error">{{ errorMessage }}</div>

    <section class="panel form-section">
      <h3>Identity</h3>
      <div class="grid-2">
        <div class="field">
          <label :for="'id'">Step ID</label>
          <input id="id" v-model="form.id" type="text" placeholder="e.g. NoHotWater_Initial" required />
          <p class="hint">Matches the source XML's DIALOG_STEP ID attribute. Letters, numbers and underscores.</p>
        </div>
        <div class="field">
          <label for="topic">Topic</label>
          <input id="topic" v-model="form.topic" type="text" placeholder="e.g. No Hot Water Diagnosis" />
        </div>
      </div>
      <div class="field">
        <label for="issueSummary">Issue summary</label>
        <textarea id="issueSummary" v-model="form.issueSummary" rows="2" placeholder="Short description of the issue this step addresses"></textarea>
      </div>
      <div class="field">
        <label for="instructions">Dialog step specific instructions <span class="optional">(optional)</span></label>
        <textarea id="instructions" v-model="form.instructions" rows="3" placeholder="Your goal is to..."></textarea>
      </div>
      <div class="field">
        <label for="stepComment">Comment <span class="optional">(optional — exported as an XML comment above this step)</span></label>
        <textarea id="stepComment" v-model="form.comment" rows="2" class="mono comment-field" placeholder="e.g. SCENARIO 1.0 NO HOT WATER"></textarea>
        <p class="hint">Separate paragraphs with a blank line to export them as multiple stacked comments.</p>
      </div>
    </section>

    <section class="panel form-section">
      <h3>Agent interaction</h3>
      <div class="grid-2">
        <div class="field">
          <label for="promptType">Prompt type</label>
          <select id="promptType" v-model="form.promptType">
            <option v-for="t in PROMPT_TYPES" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label for="promptComment">Prompt comment <span class="optional">(optional — exported as an XML comment above the Prompt)</span></label>
        <textarea id="promptComment" v-model="form.promptComment" rows="2" class="mono comment-field" placeholder="e.g. [DYNAMIC_ISSUE_SUMMARY] will be the full summary generated based on all previous steps"></textarea>
      </div>
      <div class="field">
        <label for="prompt">Prompt</label>
        <textarea id="prompt" v-model="form.prompt" rows="2" placeholder="Question or internal-processing note for this step"></textarea>
      </div>
      <div class="grid-2">
        <div class="field">
          <label for="noMatch">NoMatch reprompt <span class="optional">(optional)</span></label>
          <textarea id="noMatch" v-model="form.noMatchResponse" rows="2" placeholder="Reprompt when input isn't understood"></textarea>
        </div>
        <div class="field">
          <label for="noInput">NoInput reprompt <span class="optional">(optional)</span></label>
          <textarea id="noInput" v-model="form.noInputResponse" rows="2" placeholder="Reprompt when no input is received"></textarea>
        </div>
      </div>
    </section>

    <section class="panel form-section">
      <div class="section-header">
        <h3>Expected classifications</h3>
        <button type="button" class="btn btn-secondary" @click="addClassification">+ Add classification</button>
      </div>

      <div v-for="(c, idx) in form.classifications" :key="c.id" class="classification-row">
        <div class="classification-row__top">
          <span class="mono classification-index">#{{ idx + 1 }}</span>
          <button type="button" class="btn btn-ghost" @click="removeClassification(idx)" aria-label="Remove classification">
            Remove
          </button>
        </div>
        <div class="grid-2">
          <div class="field">
            <label>Classification ID</label>
            <input v-model="c.classificationId" type="text" placeholder="e.g. NO_HOT_WATER_MAINS_GAS" />
          </div>
          <div class="field">
            <label>Next step <span class="optional">(optional)</span></label>
            <input v-model="c.nextStep" list="target-options" type="text" placeholder="Target step ID" />
            <datalist id="target-options">
              <option v-for="t in targetOptions" :key="t.id" :value="t.id">{{ t.label }}</option>
            </datalist>
          </div>
        </div>
        <div class="field">
          <label>Trigger condition</label>
          <input v-model="c.triggerCondition" type="text" placeholder="e.g. user confirms, yes, mains gas boiler" />
        </div>
        <div class="grid-2">
          <div class="field">
            <label>RAG query parameter <span class="optional">(optional)</span></label>
            <input v-model="c.query" type="text" placeholder="Bare <Parameter name=&quot;query&quot;> value" />
          </div>
          <div class="field">
            <label>Dialog response <span class="optional">(optional)</span></label>
            <input v-model="c.dialogResponse" type="text" placeholder="e.g. Could you tell me which part..." />
          </div>
        </div>
        <div class="field">
          <label>Comment <span class="optional">(optional — exported as an XML comment above this classification)</span></label>
          <textarea v-model="c.comment" rows="2" class="mono comment-field" placeholder="e.g. SCENARIO 2.1 BOILER NOT WORKING CORRECTLY: MAINS GAS"></textarea>
        </div>

        <div class="actions-block">
          <div class="actions-block__head">
            <label class="actions-label">Actions <span class="optional">(optional, any number)</span></label>
            <button type="button" class="btn btn-ghost btn-ghost--small" @click="addAction(c)">+ Add action</button>
          </div>
          <div v-for="(a, aIdx) in c.actions" :key="a.id" class="action-row">
            <div class="grid-3">
              <div class="field">
                <label>Tool type</label>
                <input v-model="a.toolType" list="action-types" type="text" placeholder="e.g. Flow_Invocation" />
                <datalist id="action-types">
                  <option v-for="t in ACTION_TYPES" :key="t" :value="t">{{ t }}</option>
                </datalist>
              </div>
              <div class="field">
                <label>Tool ID <span class="optional">(opt.)</span></label>
                <input v-model="a.toolId" type="text" placeholder="e.g. heating_hot_water_issues_rag_tool" />
              </div>
              <div class="field">
                <label>Flow ID <span class="optional">(opt.)</span></label>
                <input v-model="a.flowId" type="text" placeholder="e.g. Default_Escalation_Hot_Water" />
              </div>
            </div>
            <div class="grid-2">
              <div class="field">
                <label>Parameter name <span class="optional">(opt.)</span></label>
                <input v-model="a.parameterName" type="text" placeholder="e.g. query" />
              </div>
              <div class="field field--with-remove">
                <label>Parameter value <span class="optional">(opt.)</span></label>
                <div class="field--with-remove__row">
                  <input v-model="a.parameterValue" type="text" placeholder="e.g. {CONCISE_SEARCH_QUERY}" />
                  <button type="button" class="btn btn-ghost btn-ghost--small" @click="removeAction(c, aIdx)">Remove</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <div class="form-actions">
      <div class="form-actions__left">
        <button
          v-if="mode === 'edit'"
          type="button"
          class="btn btn-danger"
          @click="$emit('delete')"
        >
          Delete step
        </button>
      </div>
      <div class="form-actions__right">
        <button type="button" class="btn btn-secondary" @click="$emit('cancel')">Cancel</button>
        <button type="submit" class="btn btn-primary">
          {{ mode === 'create' ? 'Create step' : 'Save changes' }}
        </button>
      </div>
    </div>
  </form>
</template>

<style scoped>
.step-form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.form-section {
  padding: 1.4rem 1.5rem;
}
.form-section h3 {
  font-size: 0.95rem;
  color: var(--navy-800);
  margin-bottom: 1rem;
}
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem 1.25rem;
}
.grid-3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 1rem 1.25rem;
}
@media (max-width: 720px) {
  .grid-2, .grid-3 { grid-template-columns: 1fr; }
}
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}
.section-header h3 { margin: 0; }
.classification-row {
  border: 1px solid var(--line);
  border-left: 3px solid var(--brand);
  border-radius: 4px;
  padding: 1rem 1.1rem 0.2rem;
  margin-bottom: 1rem;
  background: #f8f9fa;
}
.classification-row__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.4rem;
}
.classification-index {
  font-size: 0.78rem;
  color: var(--slate-500);
}
.optional {
  text-transform: none;
  letter-spacing: normal;
  font-weight: 400;
  color: var(--slate-500);
}
.comment-field {
  color: var(--ok);
  font-style: italic;
  background: #f4faf6;
}
.actions-block {
  margin: 0.4rem 0 1rem;
  padding: 0.8rem 0.9rem;
  border: 1px dashed var(--line);
  border-radius: 4px;
  background: #f4f5f6;
}
.actions-block__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}
.actions-label {
  margin: 0;
}
.action-row {
  background: var(--paper-raised);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 0.8rem 0.9rem 0.2rem;
  margin-bottom: 0.6rem;
}
.action-row:last-child {
  margin-bottom: 0;
}
.field--with-remove__row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
.field--with-remove__row input {
  flex: 1;
}
.btn-ghost--small {
  padding: 0.3em 0.5em;
  font-size: 0.76rem;
  flex-shrink: 0;
}
.form-error {
  background: #f8ece9;
  border: 1px solid #e0b3a6;
  color: var(--danger);
  padding: 0.7em 1em;
  border-radius: 4px;
  font-size: 0.88rem;
}
.form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.1rem 1rem;
}
.form-actions__right {
  display: flex;
  gap: 0.6rem;
}
</style>
