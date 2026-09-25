import { reactive, watch, computed } from 'vue'
import { seedSteps } from '../data/seedSteps.js'
import { seedPlaybook } from '../data/seedPlaybook.js'
import { seedTriagePlaybook } from '../data/seedTriagePlaybook.js'
import { registerSyncTarget, scheduleAutoSave } from './cloudSync.js'
import * as gcs from '../services/gcsClient.js'
import { parsePlaybookXml, blankGuideline } from '../utils/xmlImport.js'
import { buildLlmInstructionsXml } from '../utils/xmlExport.js'

const STORAGE_KEY = 'playbook-editor:playbooks:v1'

// The playbooks the app ships with as built-in examples. Only these ids'
// "reset" restores real seed content — any other playbook resets to blank.
// Registry keyed by id so this generalizes to any number of seed playbooks:
// each entry's `config` is the raw playbook-config shape (matches
// seedPlaybook.js), and `steps` is that playbook's seeded dialog steps
// (empty for a router/triage-style playbook, which has none).
export const SEED_PLAYBOOK_ID = 'heating-and-hot-water'
export const SEED_TRIAGE_PLAYBOOK_ID = 'triage'

const SEED_REGISTRY = {
  [SEED_PLAYBOOK_ID]: { config: seedPlaybook, steps: seedSteps },
  [SEED_TRIAGE_PLAYBOOK_ID]: { config: seedTriagePlaybook, steps: [] }
}

export function isBuiltInSeedId(id) {
  return Object.prototype.hasOwnProperty.call(SEED_REGISTRY, id)
}

// A fresh deep copy of the raw config (no id/sourceObjectPath/steps) for the
// given seed id — what store/playbook.js's resetToSeed() restores fields
// from. Returns null for a non-seed (user-created) playbook id.
export function getSeedConfigFor(id) {
  const entry = SEED_REGISTRY[id]
  return entry ? JSON.parse(JSON.stringify(entry.config)) : null
}

// A fresh deep copy of the seed steps array for the given seed id — what
// store/steps.js's resetToSeed() restores from. Empty for a seed playbook
// with no steps of its own (e.g. Triage), and for any non-seed id.
export function getSeedStepsFor(id) {
  const entry = SEED_REGISTRY[id]
  return entry ? JSON.parse(JSON.stringify(entry.steps)) : []
}

function slugify(value) {
  const base = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'playbook'
}

function buildSeedRecord(id) {
  const entry = SEED_REGISTRY[id]
  return normalizeRecord({
    id,
    sourceObjectPath: '', // not backed by a bucket file until first saved there
    ...JSON.parse(JSON.stringify(entry.config)),
    steps: JSON.parse(JSON.stringify(entry.steps))
  })
}

// Default shape for a global reprompt with no data yet — a prompt plus the
// same action shape a classification's action uses (toolType/toolId/
// flowId/parameterName/parameterValue), all independently editable.
function blankGlobalReprompt() {
  return { comment: undefined, prompt: '', action: { toolType: '', toolId: '', flowId: '', parameterName: '', parameterValue: '' } }
}

// Every playbook-level field the editor and exporter understand, copied off
// a parsed XML result (or any partial record). One list, used by every
// import path, so a newly added field can't be dropped by one of them.
const PARSED_FIELDS = [
  'setup',
  'guidelines',
  'dialogConstraints',
  'clarificationRules',
  'clarificationRulesCondition',
  'escalations',
  'globalNoMatch',
  'globalNoInput',
  'routingCategories',
  'sectionOrder',
  'sectionComments',
  'includeXmlDeclaration',
  'steps'
]

/**
 * Backfills fields added after a record was first saved (older
 * localStorage data, or JSON from an earlier version) so views can v-model
 * into them without null checks. Mutates and returns the record.
 */
export function normalizeRecord(record) {
  if (!record) return record
  record.setup = { contextInstruction: '', contextConstraint: '', role: '', objective: '', ...(record.setup || {}) }
  ;['guidelines', 'dialogConstraints', 'clarificationRules', 'escalations', 'routingCategories', 'steps'].forEach((k) => {
    if (!Array.isArray(record[k])) record[k] = []
  })
  if (typeof record.clarificationRulesCondition !== 'string') record.clarificationRulesCondition = ''
  if (!Array.isArray(record.sectionOrder)) record.sectionOrder = []
  if (!record.sectionComments || typeof record.sectionComments !== 'object') record.sectionComments = {}
  if (typeof record.includeXmlDeclaration !== 'boolean') record.includeXmlDeclaration = true
  ;['globalNoMatch', 'globalNoInput'].forEach((k) => {
    const cur = record[k] || {}
    record[k] = { ...blankGlobalReprompt(), ...cur, action: { ...blankGlobalReprompt().action, ...(cur.action || {}) } }
    if (record[k].comment === undefined) delete record[k].comment // exporter falls back to its default comment
  })
  record.guidelines = record.guidelines.map((g) => {
    const merged = { ...blankGuideline(), ...g }
    if (!g.shape) {
      merged.shape = g.rawXml?.trim() ? 'raw' : g.trigger?.trim() || g.action?.trim() ? 'structured' : 'text'
    }
    if (!Array.isArray(merged.actionSteps)) merged.actionSteps = []
    return merged
  })
  record.escalations = record.escalations.map((e) => ({ comment: '', playbookNameParam: '', ...e }))
  record.clarificationRules = record.clarificationRules.map((r) => ({ comment: '', instruction: '', ...r }))
  record.routingCategories = record.routingCategories.map((c) => ({ comment: '', ...c }))
  return record
}

function blankPlaybookRecord(id, name) {
  return {
    id,
    sourceObjectPath: '',
    playbookName: name,
    setup: { contextInstruction: '', contextConstraint: '', role: '', objective: '' },
    guidelines: [],
    dialogConstraints: [],
    clarificationRules: [],
    clarificationRulesCondition: '',
    escalations: [],
    globalNoMatch: blankGlobalReprompt(),
    globalNoInput: blankGlobalReprompt(),
    routingCategories: [],
    sectionOrder: [],
    sectionComments: {},
    includeXmlDeclaration: true,
    steps: []
  }
}

function defaultState() {
  const records = Object.keys(SEED_REGISTRY).map((id) => buildSeedRecord(id))
  return {
    playbooks: records,
    activePlaybookId: records[0].id
  }
}

function loadInitial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && Array.isArray(parsed.playbooks) && parsed.playbooks.length) {
        parsed.playbooks.forEach(normalizeRecord)
        if (!parsed.playbooks.some((p) => p.id === parsed.activePlaybookId)) {
          parsed.activePlaybookId = parsed.playbooks[0].id
        }
        return parsed
      }
    }
  } catch (e) {
    console.warn('Could not read saved playbooks, falling back to seed data.', e)
  }
  return defaultState()
}

const state = reactive(loadInitial())

watch(
  () => state,
  () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch (e) {
      console.warn('Could not persist playbooks to localStorage.', e)
    }
    scheduleAutoSave()
  },
  { deep: true }
)

function uniqueId(base) {
  let id = base
  let n = 2
  while (state.playbooks.some((p) => p.id === id)) {
    id = `${base}-${n}`
    n += 1
  }
  return id
}

/**
 * Internal accessor used by steps.js / playbook.js to read/write the
 * currently active playbook's nested data, without each of them holding
 * their own copy of state. Falls back to the first playbook if the active
 * ID is somehow stale (e.g. after a cloud load that dropped it).
 */
export function getActivePlaybookRecord() {
  let record = state.playbooks.find((p) => p.id === state.activePlaybookId)
  if (!record) {
    record = state.playbooks[0]
    if (record) state.activePlaybookId = record.id
  }
  return record
}

// ---------------------------------------------------------------------
// Google Cloud Storage sync — one .xml file per playbook, matching how the
// bucket is actually organized (e.g. "Heating and Hot Water.xml",
// "Water Taps.xml", one per playbook, in the bucket root or a folder).
// ---------------------------------------------------------------------

function sanitizeFileName(name) {
  const cleaned = String(name || 'Untitled Playbook')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '')
  return cleaned || 'Untitled Playbook'
}

// Guards against a common footgun: a prefix entered without its trailing
// slash (e.g. "flows" instead of "flows/") would otherwise get glued
// straight onto the filename ("flowsMyPlaybook.xml").
function normalizedPrefix(prefix) {
  const trimmed = (prefix || '').trim()
  if (!trimmed) return ''
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

function objectPathFor(prefix, fileNameWithoutExt) {
  return `${normalizedPrefix(prefix)}${fileNameWithoutExt}.xml`
}

function playbookRecordFromParsed(objectName, parsed, existingIds) {
  const displayName = parsed.playbookName || objectName.replace(/\.xml$/i, '')
  const base = slugify(displayName)
  let id = base
  let n = 2
  while (existingIds.has(id)) {
    id = `${base}-${n}`
    n += 1
  }
  existingIds.add(id)
  const record = { id, sourceObjectPath: objectName, playbookName: displayName }
  PARSED_FIELDS.forEach((k) => {
    if (parsed[k] !== undefined) record[k] = parsed[k]
  })
  return normalizeRecord(record)
}

/**
 * Lists every .xml object in the bucket (under `prefix`), parses each into
 * a playbook, and replaces the local collection wholesale. A file that
 * fails to parse is skipped (not fatal to the rest) and reported back.
 * @returns {Promise<{loadedCount: number, errors: Array<{name: string, message: string}>}>}
 */
async function loadAllFromBucket(bucket, prefix) {
  const objects = await gcs.listObjects(bucket, normalizedPrefix(prefix), { delimiter: '/' })
  const xmlObjects = objects.filter((o) => o.name.toLowerCase().endsWith('.xml'))
  const existingIds = new Set()
  const loaded = []
  const errors = []
  for (const obj of xmlObjects) {
    try {
      const text = await gcs.readTextObject(bucket, obj.name)
      if (text === null) continue
      const parsed = parsePlaybookXml(text)
      loaded.push(playbookRecordFromParsed(obj.name, parsed, existingIds))
    } catch (e) {
      errors.push({ name: obj.name, message: e.message })
    }
  }
  if (loaded.length) {
    state.playbooks.splice(0, state.playbooks.length, ...loaded)
    state.activePlaybookId = loaded[0].id
  }
  return { loadedCount: loaded.length, errors }
}

async function saveOneRecordToBucket(bucket, prefix, record) {
  if (!record) return
  const objectPath = record.sourceObjectPath || objectPathFor(prefix, sanitizeFileName(record.playbookName))
  const xml = buildLlmInstructionsXml(record, record.steps)
  await gcs.writeTextObject(bucket, objectPath, xml)
  record.sourceObjectPath = objectPath
}

async function saveAllToBucket(bucket, prefix) {
  for (const record of state.playbooks) {
    await saveOneRecordToBucket(bucket, prefix, record)
  }
}

async function saveActiveToBucket(bucket, prefix) {
  await saveOneRecordToBucket(bucket, prefix, getActivePlaybookRecord())
}

registerSyncTarget('playbooks', {
  loadAll: loadAllFromBucket,
  saveAll: saveAllToBucket,
  saveOne: saveActiveToBucket
})

export function usePlaybooksStore() {
  const playbooks = computed(() => state.playbooks)

  const activePlaybookId = computed({
    get: () => state.activePlaybookId,
    set: (id) => {
      if (state.playbooks.some((p) => p.id === id)) state.activePlaybookId = id
    }
  })

  const activePlaybook = computed(() => getActivePlaybookRecord())
  const isSeedPlaybook = computed(() => isBuiltInSeedId(state.activePlaybookId))

  function setActivePlaybookId(id) {
    activePlaybookId.value = id
  }

  function createPlaybook(name) {
    const trimmed = (name || '').trim()
    if (!trimmed) throw new Error('A playbook name is required.')
    const id = uniqueId(slugify(trimmed))
    const record = blankPlaybookRecord(id, trimmed)
    state.playbooks.push(record)
    state.activePlaybookId = id
    return record
  }

  function renamePlaybook(id, name) {
    const record = state.playbooks.find((p) => p.id === id)
    if (!record) throw new Error(`Playbook "${id}" not found.`)
    const trimmed = (name || '').trim()
    if (!trimmed) throw new Error('A playbook name is required.')
    record.playbookName = trimmed
  }

  function duplicatePlaybook(id) {
    const source = state.playbooks.find((p) => p.id === id)
    if (!source) throw new Error(`Playbook "${id}" not found.`)
    const clone = JSON.parse(JSON.stringify(source))
    clone.id = uniqueId(slugify(`${source.playbookName}-copy`))
    clone.playbookName = `${source.playbookName} (copy)`
    clone.sourceObjectPath = '' // must save to its own new file, never the source's
    state.playbooks.push(clone)
    state.activePlaybookId = clone.id
    return clone
  }

  // Client-side XML import — no Cloud Storage / Google sign-in required.
  // Parses a pasted or uploaded <LLM_INSTRUCTIONS> document directly with
  // the same parser Cloud Sync uses, so every field (escalations, routing
  // categories, event-handler logic, ...) ends up populated exactly as it
  // would from a bucket load.
  function importPlaybookFromXml(xmlText) {
    const parsed = parsePlaybookXml(xmlText)
    const displayName = parsed.playbookName || 'Imported playbook'
    const id = uniqueId(slugify(displayName))
    const record = { id, sourceObjectPath: '', playbookName: displayName }
    PARSED_FIELDS.forEach((k) => {
      if (parsed[k] !== undefined) record[k] = parsed[k]
    })
    normalizeRecord(record)
    state.playbooks.push(record)
    state.activePlaybookId = id
    return record
  }

  // Same parse, but overwrites the currently active playbook's content in
  // place (keeping its id and, if it has one, its bucket sourceObjectPath —
  // so a later save still overwrites the same file) rather than creating a
  // new playbook.
  function replaceActivePlaybookFromXml(xmlText) {
    const parsed = parsePlaybookXml(xmlText)
    const active = getActivePlaybookRecord()
    if (!active) throw new Error('No active playbook to import into.')
    active.playbookName = parsed.playbookName || active.playbookName
    PARSED_FIELDS.forEach((k) => {
      active[k] = parsed[k]
    })
    normalizeRecord(active)
    return active
  }

  function deletePlaybook(id) {
    if (state.playbooks.length <= 1) throw new Error('At least one playbook must remain.')
    const idx = state.playbooks.findIndex((p) => p.id === id)
    if (idx === -1) return
    state.playbooks.splice(idx, 1)
    if (state.activePlaybookId === id) {
      state.activePlaybookId = state.playbooks[0].id
    }
  }

  return {
    playbooks,
    activePlaybookId,
    activePlaybook,
    isSeedPlaybook,
    setActivePlaybookId,
    createPlaybook,
    renamePlaybook,
    duplicatePlaybook,
    deletePlaybook,
    importPlaybookFromXml,
    replaceActivePlaybookFromXml
  }
}
