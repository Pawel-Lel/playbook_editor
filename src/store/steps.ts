// Steps store: create/read/update/delete the dialog steps of the ACTIVE
// playbook. It holds no data of its own — every function reads and writes
// getActivePlaybookRecord().steps inside the main store (playbooks.js).
//
// Vue concept used here — computed(() => ...): a value derived from
// reactive data that Vue keeps up to date automatically. Here `steps`
// always points at the active playbook's step list, even after the person
// switches to another playbook.
import { computed } from 'vue'
import { getActivePlaybookRecord } from './playbooks'
import type { Action, Classification, Step, Target } from '../types'

// Unique ids for new classifications/actions: a prefix plus a number that
// only goes up (starting from the current time, so ids stay unique across
// page reloads too).
let lastGeneratedNumber = Date.now()
function generateId(prefix: string): string {
  lastGeneratedNumber += 1
  return `${prefix}${lastGeneratedNumber}`
}

// "Boiler not working?" → "Boiler_not_working" — step ids may only contain
// letters, digits, underscores and square brackets.
function toStepId(text: string): string {
  return text
    .trim()
    .replace(/[^a-zA-Z0-9_[\]]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

// A next_step that isn't one of this playbook's own steps. The XML doesn't
// say what such a target is, so infer it from naming conventions: a
// "[BRACKETED]" id is a runtime placeholder, an "..._Escalation" id hands
// off to an escalation flow; anything else is flagged as unresolved.
function externalTarget(targetId: string): Target {
  if (/^\[.*\]$/.test(targetId)) return { id: targetId, kind: 'dynamic', label: `${targetId} (runtime placeholder)` }
  if (/escalation/i.test(targetId)) return { id: targetId, kind: 'flow', label: `${targetId} (flow)` }
  return { id: targetId, kind: 'unknown', label: targetId }
}

// The normalize... functions fill in every missing field with a default,
// so the rest of the app can rely on each field existing.
function normalizeAction(action: Partial<Action>): Action {
  return {
    id: action.id || generateId('a'),
    toolType: action.toolType || '',
    toolId: action.toolId || '',
    flowId: action.flowId || '',
    parameterName: action.parameterName || '',
    parameterValue: action.parameterValue || ''
  }
}

function normalizeClassification(classification: Partial<Classification>): Classification {
  return {
    id: classification.id || generateId('c'),
    classificationId: classification.classificationId || '',
    nextStep: classification.nextStep || '',
    triggerCondition: classification.triggerCondition || '',
    query: classification.query || '',
    dialogResponse: classification.dialogResponse || '',
    comment: classification.comment || '',
    actions: (classification.actions || []).map(normalizeAction)
  }
}

function normalizeStep(stepId: string, formData: Partial<Step>): Step {
  return {
    id: stepId,
    topic: formData.topic || '',
    issueSummary: formData.issueSummary || '',
    instructions: formData.instructions || '',
    comment: formData.comment || '',
    promptType: formData.promptType || 'InitialQuery',
    promptComment: formData.promptComment || '',
    prompt: formData.prompt || '',
    noMatchResponse: formData.noMatchResponse || '',
    noInputResponse: formData.noInputResponse || '',
    classifications: (formData.classifications || []).map(normalizeClassification)
  }
}

// Every read/write below goes through getActivePlaybookRecord().steps, so
// this store always reflects whichever playbook is currently selected in
// usePlaybooksStore() — switching the active playbook is enough to make
// every view (list, edit, flow map) show a different step set.
export function useStepsStore() {
  const steps = computed(() => getActivePlaybookRecord().steps)

  const stepIds = computed(() => steps.value.map((step) => step.id))

  function getStep(stepId: string): Step | null {
    return steps.value.find((step) => step.id === stepId) || null
  }

  function idExists(stepId: string): boolean {
    return steps.value.some((step) => step.id === stepId)
  }

  // formData is what StepForm.vue submits: every field of the step.
  function createStep(formData: Partial<Step>): Step {
    const newStepId = toStepId(formData.id || formData.topic || 'New_Step')
    if (!newStepId) throw new Error('A step ID is required.')
    if (idExists(newStepId)) throw new Error(`A step with ID "${newStepId}" already exists.`)
    const newStep = normalizeStep(newStepId, formData)
    steps.value.push(newStep)
    return newStep
  }

  function updateStep(originalStepId: string, formData: Partial<Step>): Step {
    const stepIndex = steps.value.findIndex((step) => step.id === originalStepId)
    if (stepIndex === -1) throw new Error(`Step "${originalStepId}" not found.`)
    const newStepId = toStepId(formData.id || originalStepId)
    if (!newStepId) throw new Error('A step ID is required.')
    if (newStepId !== originalStepId && idExists(newStepId)) {
      throw new Error(`A step with ID "${newStepId}" already exists.`)
    }

    // splice(index, 1, newItem) replaces one array element in place.
    const updatedStep = normalizeStep(newStepId, formData)
    steps.value.splice(stepIndex, 1, updatedStep)

    // Keep referential integrity: if the ID changed, repoint any classification
    // elsewhere in the flow that targeted the old ID.
    if (newStepId !== originalStepId) {
      steps.value.forEach((step) => {
        step.classifications.forEach((classification) => {
          if (classification.nextStep === originalStepId) classification.nextStep = newStepId
        })
      })
    }
    return updatedStep
  }

  function deleteStep(stepId: string): void {
    const stepIndex = steps.value.findIndex((step) => step.id === stepId)
    if (stepIndex === -1) return
    steps.value.splice(stepIndex, 1)
  }

  function clearSteps(): void {
    steps.value.splice(0, steps.value.length)
  }

  // Every node referenced by a classification's next_step, whether or not it
  // has its own DIALOG_STEP record — used to render the relationship map and
  // to populate "next step" pickers with valid escalation/terminal targets.
  const allReferencedTargets = computed(() => {
    const targetsById = new Map<string, Target>()
    steps.value.forEach((step) => {
      targetsById.set(step.id, { id: step.id, kind: 'step', label: step.topic || step.id })
    })
    steps.value.forEach((step) => {
      step.classifications.forEach((classification) => {
        if (classification.nextStep && !targetsById.has(classification.nextStep)) {
          targetsById.set(classification.nextStep, externalTarget(classification.nextStep))
        }
      })
    })
    return Array.from(targetsById.values())
  })

  return {
    steps,
    stepIds,
    getStep,
    idExists,
    createStep,
    updateStep,
    deleteStep,
    clearSteps,
    allReferencedTargets
  }
}
