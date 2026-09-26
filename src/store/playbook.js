// Playbook store: read/edit the SETTINGS of the active playbook (setup,
// guidelines, constraints, escalations, rules, routing categories,
// document layout). Like steps.js it holds no data of its own — everything
// goes through getActivePlaybookRecord() in the main store (playbooks.js).
//
// Vue concept used here — computed with get/set: a "writable computed".
// Reading it runs `get`, assigning to it (`playbookName.value = 'X'`, or
// `v-model` in a template) runs `set`. That lets a view bind an input
// straight to a field of the active playbook.
import { computed } from 'vue'
import { getActivePlaybookRecord } from './playbooks.js'
import { blankGuideline } from '../utils/xmlImport.js'

// Unique ids for new list items: a prefix plus an ever-increasing number.
let lastGeneratedNumber = Date.now()
function nextItemId(prefix) {
  lastGeneratedNumber += 1
  return `${prefix}${lastGeneratedNumber}`
}

// For each editable list: a function returning a new, empty item.
const LIST_ITEM_DEFAULTS = {
  guidelines: () => blankGuideline(),
  dialogConstraints: () => ({ id: '', type: '', text: '', critical: '', action: '' }),
  clarificationRules: () => ({ id: '', attrName: 'condition', condition: '', prompt: '', instruction: '', comment: '' }),
  escalations: () => ({
    id: '',
    attrName: 'condition',
    condition: '',
    comment: '',
    description: '',
    trigger: '',
    escalationReason: '',
    playbookNameParam: '',
    flowName: '',
    note: ''
  }),
  routingCategories: () => ({ id: '', name: '', comment: '', triggers: '', action: '' })
}

// Id prefix per list, e.g. a new escalation gets an id like "esc1712345678".
const LIST_ID_PREFIX = {
  guidelines: 'g',
  dialogConstraints: 'dc',
  clarificationRules: 'cr',
  escalations: 'esc',
  routingCategories: 'rc'
}

// Every read/write below goes through getActivePlaybookRecord(), so this
// store always reflects whichever playbook is currently selected in
// usePlaybooksStore().
export function usePlaybookStore() {
  // A function (not a variable) so it always returns the CURRENT active playbook.
  const activeRecord = () => getActivePlaybookRecord()

  const playbookName = computed({
    get: () => activeRecord().playbookName,
    set: (newName) => {
      activeRecord().playbookName = newName
    }
  })

  const setup = computed(() => activeRecord().setup)
  const guidelines = computed(() => activeRecord().guidelines)
  const dialogConstraints = computed(() => activeRecord().dialogConstraints)
  const clarificationRules = computed(() => activeRecord().clarificationRules)
  const escalations = computed(() => activeRecord().escalations)
  const routingCategories = computed(() => activeRecord().routingCategories)

  // A router/triage-style playbook's optional shared clarification
  // condition — exposed as a writable computed the same way playbookName
  // is, so views can v-model it directly.
  const clarificationRulesCondition = computed({
    get: () => activeRecord().clarificationRulesCondition || '',
    set: (newCondition) => {
      activeRecord().clarificationRulesCondition = newCondition
    }
  })

  // The two global (playbook-level) reprompts — each a { prompt, action }
  // object (action has the same toolType/toolId/flowId/parameterName/
  // parameterValue shape as a classification's action), exposed as a plain
  // object reference like setup, so views can v-model into its fields
  // directly (e.g. playbookStore.globalNoMatch.value.action.toolId).
  const globalNoMatch = computed(() => activeRecord().globalNoMatch)
  const globalNoInput = computed(() => activeRecord().globalNoInput)

  // Document layout: which top-level sections are written and in what
  // order, the <!-- ... --> comment above each, and whether the file starts
  // with an <?xml ...?> declaration (Triage.xml doesn't).
  const sectionOrder = computed({
    get: () => activeRecord().sectionOrder || [],
    set: (newOrder) => {
      activeRecord().sectionOrder = newOrder
    }
  })
  const sectionComments = computed(() => {
    if (!activeRecord().sectionComments) activeRecord().sectionComments = {}
    return activeRecord().sectionComments
  })
  const includeXmlDeclaration = computed({
    get: () => activeRecord().includeXmlDeclaration !== false,
    set: (shouldInclude) => {
      activeRecord().includeXmlDeclaration = !!shouldInclude
    }
  })

  // Guideline <ACTION> steps (<SET_PARAMETER> / <INVOKE_FLOW>) — CRUD within
  // one policy, e.g. CANCELLATION_OVERRIDE.
  function addActionStep(guidelineId, actionKind = 'SET_PARAMETER') {
    const guideline = activeRecord().guidelines.find((candidate) => candidate.id === guidelineId)
    if (!guideline) throw new Error(`Guideline "${guidelineId}" not found`)
    if (!Array.isArray(guideline.actionSteps)) guideline.actionSteps = []
    const newActionStep = { id: nextItemId('as'), kind: actionKind, name: '', value: '' }
    guideline.actionSteps.push(newActionStep)
    return newActionStep
  }

  function removeActionStep(guidelineId, actionStepId) {
    const guideline = activeRecord().guidelines.find((candidate) => candidate.id === guidelineId)
    if (!guideline?.actionSteps) return
    const actionStepIndex = guideline.actionSteps.findIndex((actionStep) => actionStep.id === actionStepId)
    if (actionStepIndex !== -1) guideline.actionSteps.splice(actionStepIndex, 1)
  }

  // Reorders any list section (guidelines, escalations, rules, categories)
  // — order is significant in the XML. `direction` is -1 (up) or +1 (down).
  function moveItem(sectionName, itemId, direction) {
    const sectionList = activeRecord()[sectionName]
    if (!Array.isArray(sectionList)) return
    const currentIndex = sectionList.findIndex((item) => item.id === itemId)
    const newIndex = currentIndex + direction
    if (currentIndex === -1 || newIndex < 0 || newIndex >= sectionList.length) return
    const [movedItem] = sectionList.splice(currentIndex, 1) // take it out...
    sectionList.splice(newIndex, 0, movedItem) // ...and put it back one place over
  }

  function updateSetup(newSetup) {
    activeRecord().setup.contextInstruction = newSetup.contextInstruction || ''
    activeRecord().setup.contextConstraint = newSetup.contextConstraint || ''
    activeRecord().setup.role = newSetup.role || ''
    activeRecord().setup.objective = newSetup.objective || ''
  }

  // sectionName is one of the LIST_ITEM_DEFAULTS keys, e.g. 'escalations'.
  function addItem(sectionName, initialFields = {}) {
    const createBlankItem = LIST_ITEM_DEFAULTS[sectionName]
    if (!createBlankItem) throw new Error(`Unknown playbook section "${sectionName}"`)
    const newItem = { ...createBlankItem(), ...initialFields, id: nextItemId(LIST_ID_PREFIX[sectionName]) }
    activeRecord()[sectionName].push(newItem)
    return newItem
  }

  function updateItem(sectionName, itemId, updatedFields) {
    const sectionList = activeRecord()[sectionName]
    if (!sectionList) throw new Error(`Unknown playbook section "${sectionName}"`)
    const itemIndex = sectionList.findIndex((item) => item.id === itemId)
    if (itemIndex === -1) throw new Error(`Item "${itemId}" not found in "${sectionName}"`)
    sectionList.splice(itemIndex, 1, { ...updatedFields, id: itemId })
  }

  function removeItem(sectionName, itemId) {
    const sectionList = activeRecord()[sectionName]
    if (!sectionList) return
    const itemIndex = sectionList.findIndex((item) => item.id === itemId)
    if (itemIndex !== -1) sectionList.splice(itemIndex, 1)
  }

  function clearSettings() {
    const record = activeRecord()
    record.setup.contextInstruction = ''
    record.setup.contextConstraint = ''
    record.setup.role = ''
    record.setup.objective = ''
    record.guidelines.splice(0, record.guidelines.length)
    record.dialogConstraints.splice(0, record.dialogConstraints.length)
    record.clarificationRules.splice(0, record.clarificationRules.length)
    record.clarificationRulesCondition = ''
    record.escalations.splice(0, record.escalations.length)
    record.globalNoMatch = { prompt: '', action: { toolType: '', toolId: '', flowId: '', parameterName: '', parameterValue: '' } }
    record.globalNoInput = { prompt: '', action: { toolType: '', toolId: '', flowId: '', parameterName: '', parameterValue: '' } }
    record.routingCategories.splice(0, record.routingCategories.length)
    record.sectionOrder = []
    record.sectionComments = {}
    record.includeXmlDeclaration = true
  }

  // Single source of truth for "everything buildLlmInstructionsXml needs
  // from the playbook side" — every export call-site should build its
  // payload through this rather than listing fields by hand, so a new field
  // added here can't be silently missed at some (but not all) call sites.
  function toExportPayload() {
    return {
      playbookName: playbookName.value,
      setup: setup.value,
      guidelines: guidelines.value,
      dialogConstraints: dialogConstraints.value,
      clarificationRules: clarificationRules.value,
      clarificationRulesCondition: clarificationRulesCondition.value,
      escalations: escalations.value,
      globalNoMatch: globalNoMatch.value,
      globalNoInput: globalNoInput.value,
      routingCategories: routingCategories.value,
      sectionOrder: sectionOrder.value,
      sectionComments: sectionComments.value,
      includeXmlDeclaration: includeXmlDeclaration.value
    }
  }

  return {
    playbookName,
    setup,
    guidelines,
    dialogConstraints,
    clarificationRules,
    clarificationRulesCondition,
    escalations,
    globalNoMatch,
    globalNoInput,
    routingCategories,
    sectionOrder,
    sectionComments,
    includeXmlDeclaration,
    updateSetup,
    addItem,
    updateItem,
    removeItem,
    moveItem,
    addActionStep,
    removeActionStep,
    clearSettings,
    toExportPayload
  }
}
