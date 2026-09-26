<script setup lang="ts">
// StepForm — the form for creating or editing one dialog step. Used by
// both StepCreateView (mode 'create') and StepEditView (mode 'edit').
//
// Vue concepts used in this file:
//  - defineProps<{...}>(): declares the inputs ("props") the parent passes
//    in, e.g. <StepForm :initial-step="step" mode="edit" />. Props are
//    read-only for this component.
//  - defineEmits<{...}>(): declares the events this component sends up to
//    its parent; the parent listens with @submit="...", @cancel="...".
//  - reactive(object): an object Vue watches — the form fields below.
//    `v-model="stepForm.topic"` in the template keeps an input and that
//    field in sync both ways.
//  - watch(source, callback): runs callback whenever `source` changes.
//  - computed(() => ...): a value derived from other reactive data.
import { reactive, watch, computed } from 'vue'
import type { Action, Classification, Step, Target } from '../types'

// withDefaults(defineProps<{...}>(), {...}): the props and their types,
// then the default value for each optional (`?`) one.
const props = withDefaults(
  defineProps<{
    initialStep?: Step | null // the step being edited (null when creating)
    mode?: 'create' | 'edit'
    allTargets?: Target[] // suggestions for "Next step"
    errorMessage?: string
  }>(),
  { initialStep: null, mode: 'create', allTargets: () => [], errorMessage: '' }
)

// Each event name, with the values it sends in [brackets].
const emit = defineEmits<{
  submit: [submittedStep: Step]
  cancel: []
  delete: []
}>()

// Choices offered in the "Prompt type" dropdown and "Tool type" suggestions.
const PROMPT_TYPES = ['InitialQuery', 'ConfirmationQuery', 'InternalProcessing']
const ACTION_TYPES = ['Flow_Invocation', 'RAG_Retrieval', 'Tool_Invocation', 'Internal_State_Update']

// A random, temporary id — only needed so v-for's :key stays stable while
// editing; the steps store gives items their permanent ids on save.
function temporaryId(prefix: string): string {
  return `${prefix}${Math.random().toString(36).slice(2, 9)}`
}

function blankAction(): Action {
  return {
    id: temporaryId('tmpa_'),
    toolType: '',
    toolId: '',
    flowId: '',
    parameterName: '',
    parameterValue: ''
  }
}

function blankClassification(): Classification {
  return {
    id: temporaryId('tmp_'),
    classificationId: '',
    nextStep: '',
    triggerCondition: '',
    query: '',
    dialogResponse: '',
    comment: '',
    actions: []
  }
}

// Builds the form's data from an existing step (or blank, when creating).
// Classifications and actions are copied ({ ...x }) so typing in the form
// doesn't change the saved step until the person clicks Save.
function makeFormState(sourceStep: Step | null): Step {
  return reactive<Step>({
    id: sourceStep?.id || '',
    topic: sourceStep?.topic || '',
    issueSummary: sourceStep?.issueSummary || '',
    instructions: sourceStep?.instructions || '',
    comment: sourceStep?.comment || '',
    promptType: sourceStep?.promptType || 'InitialQuery',
    promptComment: sourceStep?.promptComment || '',
    prompt: sourceStep?.prompt || '',
    noMatchResponse: sourceStep?.noMatchResponse || '',
    noInputResponse: sourceStep?.noInputResponse || '',
    classifications: sourceStep?.classifications?.length
      ? sourceStep.classifications.map((classification) => ({
          ...classification,
          actions: (classification.actions || []).map((action) => ({ ...action }))
        }))
      : [blankClassification()]
  })
}

// Everything the inputs below are bound to with v-model.
const stepForm = makeFormState(props.initialStep)

// If the parent passes a different step (e.g. the URL changed to another
// step), refill the form with it.
watch(
  () => props.initialStep,
  (newInitialStep) => {
    Object.assign(stepForm, makeFormState(newInitialStep))
  }
)

function addClassification() {
  stepForm.classifications.push(blankClassification())
}
function removeClassification(classificationIndex: number): void {
  stepForm.classifications.splice(classificationIndex, 1)
  // Always keep at least one (empty) classification row on screen.
  if (stepForm.classifications.length === 0) stepForm.classifications.push(blankClassification())
}
function addAction(classification: Classification): void {
  classification.actions.push(blankAction())
}
function removeAction(classification: Classification, actionIndex: number): void {
  classification.actions.splice(actionIndex, 1)
}

const nextStepSuggestions = computed(() => props.allTargets)

// Sends a plain (non-reactive) copy of the form to the parent, which saves it.
function handleSubmit() {
  emit('submit', JSON.parse(JSON.stringify(stepForm)))
}
</script>

<!--
  Template syntax used below:
   - v-model="stepForm.x"   two-way binding between an input and a field.
   - @submit.prevent        handle the form's submit event and stop the
                            browser's default full-page reload.
   - v-for="(item, index) in list"
                            repeat an element per list item; `index` is
                            its position (0, 1, 2...).
   - $emit('cancel')        send an event to the parent straight from the template.
-->
<template>
  <form class="step-form" @submit.prevent="handleSubmit">
    <div v-if="errorMessage" class="form-error">{{ errorMessage }}</div>

    <section class="panel form-section">
      <h3>Identity</h3>
      <div class="grid-2">
        <div class="field">
          <label :for="'id'">Step ID</label>
          <input id="id" v-model="stepForm.id" type="text" placeholder="e.g. NoHotWater_Initial" required />
          <p class="hint">Matches the source XML's DIALOG_STEP ID attribute. Letters, numbers and underscores.</p>
        </div>
        <div class="field">
          <label for="topic">Topic</label>
          <input id="topic" v-model="stepForm.topic" type="text" placeholder="e.g. No Hot Water Diagnosis" />
        </div>
      </div>
      <div class="field">
        <label for="issueSummary">Issue summary</label>
        <textarea id="issueSummary" v-model="stepForm.issueSummary" rows="2" placeholder="Short description of the issue this step addresses"></textarea>
      </div>
      <div class="field">
        <label for="instructions">Dialog step specific instructions <span class="optional">(optional)</span></label>
        <textarea id="instructions" v-model="stepForm.instructions" rows="3" placeholder="Your goal is to..."></textarea>
      </div>
      <div class="field">
        <label for="stepComment">Comment <span class="optional">(optional — exported as an XML comment above this step)</span></label>
        <textarea id="stepComment" v-model="stepForm.comment" rows="2" class="mono comment-field" placeholder="e.g. SCENARIO 1.0 NO HOT WATER"></textarea>
        <p class="hint">Separate paragraphs with a blank line to export them as multiple stacked comments.</p>
      </div>
    </section>

    <section class="panel form-section">
      <h3>Agent interaction</h3>
      <div class="grid-2">
        <div class="field">
          <label for="promptType">Prompt type</label>
          <select id="promptType" v-model="stepForm.promptType">
            <option v-for="promptType in PROMPT_TYPES" :key="promptType" :value="promptType">{{ promptType }}</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label for="promptComment">Prompt comment <span class="optional">(optional — exported as an XML comment above the Prompt)</span></label>
        <textarea id="promptComment" v-model="stepForm.promptComment" rows="2" class="mono comment-field" placeholder="e.g. [DYNAMIC_ISSUE_SUMMARY] will be the full summary generated based on all previous steps"></textarea>
      </div>
      <div class="field">
        <label for="prompt">Prompt</label>
        <textarea id="prompt" v-model="stepForm.prompt" rows="2" placeholder="Question or internal-processing note for this step"></textarea>
      </div>
      <div class="grid-2">
        <div class="field">
          <label for="noMatch">NoMatch reprompt <span class="optional">(optional)</span></label>
          <textarea id="noMatch" v-model="stepForm.noMatchResponse" rows="2" placeholder="Reprompt when input isn't understood"></textarea>
        </div>
        <div class="field">
          <label for="noInput">NoInput reprompt <span class="optional">(optional)</span></label>
          <textarea id="noInput" v-model="stepForm.noInputResponse" rows="2" placeholder="Reprompt when no input is received"></textarea>
        </div>
      </div>
    </section>

    <section class="panel form-section">
      <div class="section-header">
        <h3>Expected classifications</h3>
        <button type="button" class="btn btn-secondary" @click="addClassification">+ Add classification</button>
      </div>

      <!-- One block per classification (the possible answers to this step). -->
      <div
        v-for="(classification, classificationIndex) in stepForm.classifications"
        :key="classification.id"
        class="classification-row"
      >
        <div class="classification-row__top">
          <span class="mono classification-index">#{{ classificationIndex + 1 }}</span>
          <button type="button" class="btn btn-ghost" @click="removeClassification(classificationIndex)" aria-label="Remove classification">
            Remove
          </button>
        </div>
        <div class="grid-2">
          <div class="field">
            <label>Classification ID</label>
            <input v-model="classification.classificationId" type="text" placeholder="e.g. NO_HOT_WATER_MAINS_GAS" />
          </div>
          <div class="field">
            <label>Next step <span class="optional">(optional)</span></label>
            <!-- list="..." links the input to the <datalist> of suggestions below. -->
            <input v-model="classification.nextStep" list="target-options" type="text" placeholder="Target step ID" />
            <datalist id="target-options">
              <option v-for="target in nextStepSuggestions" :key="target.id" :value="target.id">{{ target.label }}</option>
            </datalist>
          </div>
        </div>
        <div class="field">
          <label>Trigger condition</label>
          <input v-model="classification.triggerCondition" type="text" placeholder="e.g. user confirms, yes, mains gas boiler" />
        </div>
        <div class="grid-2">
          <div class="field">
            <label>RAG query parameter <span class="optional">(optional)</span></label>
            <input v-model="classification.query" type="text" placeholder="Bare <Parameter name=&quot;query&quot;> value" />
          </div>
          <div class="field">
            <label>Dialog response <span class="optional">(optional)</span></label>
            <input v-model="classification.dialogResponse" type="text" placeholder="e.g. Could you tell me which part..." />
          </div>
        </div>
        <div class="field">
          <label>Comment <span class="optional">(optional — exported as an XML comment above this classification)</span></label>
          <textarea v-model="classification.comment" rows="2" class="mono comment-field" placeholder="e.g. SCENARIO 2.1 BOILER NOT WORKING CORRECTLY: MAINS GAS"></textarea>
        </div>

        <div class="actions-block">
          <div class="actions-block__head">
            <label class="actions-label">Actions <span class="optional">(optional, any number)</span></label>
            <button type="button" class="btn btn-ghost btn-ghost--small" @click="addAction(classification)">+ Add action</button>
          </div>
          <!-- A v-for inside a v-for: the actions of THIS classification. -->
          <div v-for="(action, actionIndex) in classification.actions" :key="action.id" class="action-row">
            <div class="grid-3">
              <div class="field">
                <label>Tool type</label>
                <input v-model="action.toolType" list="action-types" type="text" placeholder="e.g. Flow_Invocation" />
                <datalist id="action-types">
                  <option v-for="actionType in ACTION_TYPES" :key="actionType" :value="actionType">{{ actionType }}</option>
                </datalist>
              </div>
              <div class="field">
                <label>Tool ID <span class="optional">(opt.)</span></label>
                <input v-model="action.toolId" type="text" placeholder="e.g. heating_hot_water_issues_rag_tool" />
              </div>
              <div class="field">
                <label>Flow ID <span class="optional">(opt.)</span></label>
                <input v-model="action.flowId" type="text" placeholder="e.g. Default_Escalation_Hot_Water" />
              </div>
            </div>
            <div class="grid-2">
              <div class="field">
                <label>Parameter name <span class="optional">(opt.)</span></label>
                <input v-model="action.parameterName" type="text" placeholder="e.g. query" />
              </div>
              <div class="field field--with-remove">
                <label>Parameter value <span class="optional">(opt.)</span></label>
                <div class="field--with-remove__row">
                  <input v-model="action.parameterValue" type="text" placeholder="e.g. {CONCISE_SEARCH_QUERY}" />
                  <button type="button" class="btn btn-ghost btn-ghost--small" @click="removeAction(classification, actionIndex)">Remove</button>
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
