import { reactive, watch, computed } from 'vue'
import { registerSyncTarget, scheduleAutoSave } from './cloudSync.js'
import * as gcs from '../services/gcsClient.js'
import * as localFolder from '../services/localFolder.js'
import { parsePlaybookXml, blankGuideline } from '../utils/xmlImport.js'
import { buildLlmInstructionsXml, downloadTextFile } from '../utils/xmlExport.js'

const STORAGE_KEY = 'playbook-editor:playbooks:v1'

function slugify(value) {
  const base = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'playbook'
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
    localFileName: '',
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

// No data ships with the app: playbooks come from a Google Cloud Storage
// bucket (Cloud sync) or a local folder. Until one is loaded, a single
// blank playbook keeps the "there is always an active playbook" invariant
// every view relies on.
function defaultState() {
  const record = blankPlaybookRecord('untitled-playbook', 'Untitled playbook')
  return {
    playbooks: [record],
    activePlaybookId: record.id
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
    console.warn('Could not read saved playbooks, starting with a blank playbook.', e)
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

// `origin` records where the file came from — { sourceObjectPath } for a
// bucket object, { localFileName } for a file in a local folder — so later
// saves overwrite that same file.
function playbookRecordFromParsed(fileName, parsed, existingIds, origin) {
  const displayName = parsed.playbookName || fileName.replace(/\.xml$/i, '')
  const base = slugify(displayName)
  let id = base
  let n = 2
  while (existingIds.has(id)) {
    id = `${base}-${n}`
    n += 1
  }
  existingIds.add(id)
  const record = { id, sourceObjectPath: '', localFileName: '', ...origin, playbookName: displayName }
  PARSED_FIELDS.forEach((k) => {
    if (parsed[k] !== undefined) record[k] = parsed[k]
  })
  return normalizeRecord(record)
}

// Replaces the local collection wholesale with what a bucket or folder
// load found. Leaves it untouched when nothing loaded.
function replaceCollection(records) {
  if (!records.length) return
  state.playbooks.splice(0, state.playbooks.length, ...records)
  state.activePlaybookId = records[0].id
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
      loaded.push(playbookRecordFromParsed(obj.name.split('/').pop(), parsed, existingIds, { sourceObjectPath: obj.name }))
    } catch (e) {
      errors.push({ name: obj.name, message: e.message })
    }
  }
  replaceCollection(loaded)
  return { loadedCount: loaded.length, errors }
}

async function saveOneRecordToBucket(bucket, prefix, record) {
  if (!record) return
  const objectPath = record.sourceObjectPath || objectPathFor(prefix, localFileNameFor(record).replace(/\.xml$/i, ''))
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

// ---------------------------------------------------------------------
// Local folder save — writes the active playbook's .xml into a folder on
// disk (see services/localFolder.js), named exactly as it is (or will be)
// in the bucket, so the local folder mirrors the bucket's layout.
// ---------------------------------------------------------------------

function localFileNameFor(record) {
  if (record.localFileName) return record.localFileName
  if (record.sourceObjectPath) return record.sourceObjectPath.split('/').pop()
  return `${sanitizeFileName(record.playbookName)}.xml`
}

/**
 * Saves the active playbook to the remembered local folder (prompting for
 * one the first time), or downloads it where folder access isn't
 * supported. Must be called from a click handler.
 * @param {{ pickFolder?: boolean }} opts - pickFolder: choose a new folder first
 * @returns {Promise<{ fileName: string, folderName: string|null }>}
 */
async function saveActiveToLocalFolder({ pickFolder = false } = {}) {
  const record = getActivePlaybookRecord()
  if (!record) throw new Error('No active playbook to save.')
  const fileName = localFileNameFor(record)
  const xml = buildLlmInstructionsXml(record, record.steps)
  if (!localFolder.isSupported()) {
    downloadTextFile(fileName, xml)
    return { fileName, folderName: null }
  }
  if (pickFolder) await localFolder.chooseFolder()
  const folderName = await localFolder.writeTextFile(fileName, xml)
  record.localFileName = fileName
  return { fileName, folderName }
}

/**
 * Loads every .xml file in the remembered local folder (prompting for one
 * the first time, or when pickFolder is set) and replaces the local
 * collection with them, exactly like a bucket load. A file that fails to
 * parse is skipped and reported back. Must be called from a click handler.
 * confirmReplace(count) runs after the folder is read — not before, since
 * a dialog ahead of the folder picker would use up the click's user
 * activation — and returning false leaves the collection unchanged.
 * @param {{ pickFolder?: boolean, confirmReplace?: (count: number) => boolean }} opts
 * @returns {Promise<{ folderName: string, loadedCount: number, errors: Array<{name: string, message: string}>, cancelled?: boolean }>}
 */
async function loadAllFromLocalFolder({ pickFolder = false, confirmReplace } = {}) {
  if (!localFolder.isSupported()) {
    throw new Error('This browser cannot open local folders — use Chrome or Edge, or import a single file instead.')
  }
  if (pickFolder) await localFolder.chooseFolder()
  const { folderName, files } = await localFolder.readXmlFiles()
  const existingIds = new Set()
  const loaded = []
  const errors = []
  for (const file of files) {
    try {
      const parsed = parsePlaybookXml(file.text)
      loaded.push(playbookRecordFromParsed(file.name, parsed, existingIds, { localFileName: file.name }))
    } catch (e) {
      errors.push({ name: file.name, message: e.message })
    }
  }
  if (loaded.length && confirmReplace && !confirmReplace(loaded.length)) {
    return { folderName, loadedCount: 0, errors, cancelled: true }
  }
  replaceCollection(loaded)
  return { folderName, loadedCount: loaded.length, errors }
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
    clone.sourceObjectPath = '' // must save to its own new files, never the source's
    clone.localFileName = ''
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
    const record = { id, sourceObjectPath: '', localFileName: '', playbookName: displayName }
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
    setActivePlaybookId,
    createPlaybook,
    renamePlaybook,
    duplicatePlaybook,
    deletePlaybook,
    importPlaybookFromXml,
    replaceActivePlaybookFromXml,
    saveActiveToLocalFolder,
    loadAllFromLocalFolder
  }
}
