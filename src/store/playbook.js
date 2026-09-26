import { computed } from 'vue'
import { getActivePlaybookRecord } from './playbooks.js'
import { blankGuideline } from '../utils/xmlImport.js'

let itemCounter = Date.now()
function nextItemId(prefix) {
  itemCounter += 1
  return `${prefix}${itemCounter}`
}

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

const LIST_PREFIX = {
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
  const record = () => getActivePlaybookRecord()

  const playbookName = computed({
    get: () => record().playbookName,
    set: (val) => {
      record().playbookName = val
    }
  })

  const setup = computed(() => record().setup)
  const guidelines = computed(() => record().guidelines)
  const dialogConstraints = computed(() => record().dialogConstraints)
  const clarificationRules = computed(() => record().clarificationRules)
  const escalations = computed(() => record().escalations)
  const routingCategories = computed(() => record().routingCategories)

  // A router/triage-style playbook's optional shared clarification
  // condition — exposed as a writable computed the same way playbookName
  // is, so views can v-model it directly.
  const clarificationRulesCondition = computed({
    get: () => record().clarificationRulesCondition || '',
    set: (val) => {
      record().clarificationRulesCondition = val
    }
  })

  // The two global (playbook-level) reprompts — each a { prompt, action }
  // object (action has the same toolType/toolId/flowId/parameterName/
  // parameterValue shape as a classification's action), exposed as a plain
  // object reference like setup, so views can v-model into its fields
  // directly (e.g. playbook.globalNoMatch.value.action.toolId).
  const globalNoMatch = computed(() => record().globalNoMatch)
  const globalNoInput = computed(() => record().globalNoInput)

  // Document layout: which top-level sections are written and in what
  // order, the <!-- ... --> comment above each, and whether the file starts
  // with an <?xml ...?> declaration (Triage.xml doesn't).
  const sectionOrder = computed({
    get: () => record().sectionOrder || [],
    set: (val) => {
      record().sectionOrder = val
    }
  })
  const sectionComments = computed(() => {
    if (!record().sectionComments) record().sectionComments = {}
    return record().sectionComments
  })
  const includeXmlDeclaration = computed({
    get: () => record().includeXmlDeclaration !== false,
    set: (val) => {
      record().includeXmlDeclaration = !!val
    }
  })

  // Guideline <ACTION> steps (<SET_PARAMETER> / <INVOKE_FLOW>) — CRUD within
  // one policy, e.g. CANCELLATION_OVERRIDE.
  function addActionStep(guidelineId, kind = 'SET_PARAMETER') {
    const g = record().guidelines.find((it) => it.id === guidelineId)
    if (!g) throw new Error(`Guideline "${guidelineId}" not found`)
    if (!Array.isArray(g.actionSteps)) g.actionSteps = []
    const step = { id: nextItemId('as'), kind, name: '', value: '' }
    g.actionSteps.push(step)
    return step
  }

  function removeActionStep(guidelineId, stepId) {
    const g = record().guidelines.find((it) => it.id === guidelineId)
    if (!g?.actionSteps) return
    const idx = g.actionSteps.findIndex((st) => st.id === stepId)
    if (idx !== -1) g.actionSteps.splice(idx, 1)
  }

  // Reorders any list section (guidelines, escalations, rules, categories)
  // — order is significant in the XML.
  function moveItem(section, id, delta) {
    const list = record()[section]
    if (!Array.isArray(list)) return
    const idx = list.findIndex((it) => it.id === id)
    const to = idx + delta
    if (idx === -1 || to < 0 || to >= list.length) return
    const [item] = list.splice(idx, 1)
    list.splice(to, 0, item)
  }

  function updateSetup(payload) {
    record().setup.contextInstruction = payload.contextInstruction || ''
    record().setup.contextConstraint = payload.contextConstraint || ''
    record().setup.role = payload.role || ''
    record().setup.objective = payload.objective || ''
  }

  function addItem(section, partial = {}) {
    const factory = LIST_ITEM_DEFAULTS[section]
    if (!factory) throw new Error(`Unknown playbook section "${section}"`)
    const item = { ...factory(), ...partial, id: nextItemId(LIST_PREFIX[section]) }
    record()[section].push(item)
    return item
  }

  function updateItem(section, id, payload) {
    const list = record()[section]
    if (!list) throw new Error(`Unknown playbook section "${section}"`)
    const idx = list.findIndex((it) => it.id === id)
    if (idx === -1) throw new Error(`Item "${id}" not found in "${section}"`)
    list.splice(idx, 1, { ...payload, id })
  }

  function removeItem(section, id) {
    const list = record()[section]
    if (!list) return
    const idx = list.findIndex((it) => it.id === id)
    if (idx !== -1) list.splice(idx, 1)
  }

  function clearSettings() {
    const active = record()
    active.setup.contextInstruction = ''
    active.setup.contextConstraint = ''
    active.setup.role = ''
    active.setup.objective = ''
    active.guidelines.splice(0, active.guidelines.length)
    active.dialogConstraints.splice(0, active.dialogConstraints.length)
    active.clarificationRules.splice(0, active.clarificationRules.length)
    active.clarificationRulesCondition = ''
    active.escalations.splice(0, active.escalations.length)
    active.globalNoMatch = { prompt: '', action: { toolType: '', toolId: '', flowId: '', parameterName: '', parameterValue: '' } }
    active.globalNoInput = { prompt: '', action: { toolType: '', toolId: '', flowId: '', parameterName: '', parameterValue: '' } }
    active.routingCategories.splice(0, active.routingCategories.length)
    active.sectionOrder = []
    active.sectionComments = {}
    active.includeXmlDeclaration = true
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
