import { computed } from 'vue'
import { getActivePlaybookRecord } from './playbooks.js'

let idCounter = Date.now()
function newId(prefix) {
  idCounter += 1
  return `${prefix}${idCounter}`
}

function slugify(value) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_[\]]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

// A next_step that isn't one of this playbook's own steps. The XML doesn't
// say what such a target is, so infer it from naming conventions: a
// "[BRACKETED]" id is a runtime placeholder, an "..._Escalation" id hands
// off to an escalation flow; anything else is flagged as unresolved.
function externalTarget(id) {
  if (/^\[.*\]$/.test(id)) return { id, kind: 'dynamic', label: `${id} (runtime placeholder)` }
  if (/escalation/i.test(id)) return { id, kind: 'flow', label: `${id} (flow)` }
  return { id, kind: 'unknown', label: id }
}

function normalizeAction(a) {
  return {
    id: a.id || newId('a'),
    toolType: a.toolType || '',
    toolId: a.toolId || '',
    flowId: a.flowId || '',
    parameterName: a.parameterName || '',
    parameterValue: a.parameterValue || ''
  }
}

function normalizeClassification(c) {
  return {
    id: c.id || newId('c'),
    classificationId: c.classificationId || '',
    nextStep: c.nextStep || '',
    triggerCondition: c.triggerCondition || '',
    query: c.query || '',
    dialogResponse: c.dialogResponse || '',
    comment: c.comment || '',
    actions: (c.actions || []).map(normalizeAction)
  }
}

function normalizeStep(id, payload) {
  return {
    id,
    topic: payload.topic || '',
    issueSummary: payload.issueSummary || '',
    instructions: payload.instructions || '',
    comment: payload.comment || '',
    promptType: payload.promptType || 'InitialQuery',
    promptComment: payload.promptComment || '',
    prompt: payload.prompt || '',
    noMatchResponse: payload.noMatchResponse || '',
    noInputResponse: payload.noInputResponse || '',
    classifications: (payload.classifications || []).map(normalizeClassification)
  }
}

// Every read/write below goes through getActivePlaybookRecord().steps, so
// this store always reflects whichever playbook is currently selected in
// usePlaybooksStore() — switching the active playbook is enough to make
// every view (list, edit, flow map) show a different step set.
export function useStepsStore() {
  const steps = computed(() => getActivePlaybookRecord().steps)

  const stepIds = computed(() => steps.value.map((s) => s.id))

  function getStep(id) {
    return steps.value.find((s) => s.id === id) || null
  }

  function idExists(id) {
    return steps.value.some((s) => s.id === id)
  }

  function createStep(payload) {
    const id = slugify(payload.id || payload.topic || 'New_Step')
    if (!id) throw new Error('A step ID is required.')
    if (idExists(id)) throw new Error(`A step with ID "${id}" already exists.`)
    const step = normalizeStep(id, payload)
    steps.value.push(step)
    return step
  }

  function updateStep(originalId, payload) {
    const idx = steps.value.findIndex((s) => s.id === originalId)
    if (idx === -1) throw new Error(`Step "${originalId}" not found.`)
    const newId = slugify(payload.id || originalId)
    if (!newId) throw new Error('A step ID is required.')
    if (newId !== originalId && idExists(newId)) {
      throw new Error(`A step with ID "${newId}" already exists.`)
    }

    const updated = normalizeStep(newId, payload)
    steps.value.splice(idx, 1, updated)

    // Keep referential integrity: if the ID changed, repoint any classification
    // elsewhere in the flow that targeted the old ID.
    if (newId !== originalId) {
      steps.value.forEach((s) => {
        s.classifications.forEach((c) => {
          if (c.nextStep === originalId) c.nextStep = newId
        })
      })
    }
    return updated
  }

  function deleteStep(id) {
    const idx = steps.value.findIndex((s) => s.id === id)
    if (idx === -1) return
    steps.value.splice(idx, 1)
  }

  function clearSteps() {
    steps.value.splice(0, steps.value.length)
  }

  // Every node referenced by a classification's next_step, whether or not it
  // has its own DIALOG_STEP record — used to render the relationship map and
  // to populate "next step" pickers with valid escalation/terminal targets.
  const allReferencedTargets = computed(() => {
    const targets = new Map()
    steps.value.forEach((s) => {
      targets.set(s.id, { id: s.id, kind: 'step', label: s.topic || s.id })
    })
    steps.value.forEach((s) => {
      s.classifications.forEach((c) => {
        if (c.nextStep && !targets.has(c.nextStep)) {
          targets.set(c.nextStep, externalTarget(c.nextStep))
        }
      })
    })
    return Array.from(targets.values())
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
