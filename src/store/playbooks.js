// The main store: the list of all playbooks, and which one is active.
//
// A "store" is shared state that many components read and change. This
// app doesn't use a store library (like Pinia) — each store is a plain
// JavaScript module holding one reactive object, plus a `use...Store()`
// function that components call to get at it. Because a module is only
// ever loaded once, every component sees the very same data.
//
// Vue concepts used in this file:
//  - reactive(object): wraps an object so Vue notices when any property
//    (even deeply nested) changes, and re-renders whatever uses it.
//  - watch(source, callback): runs `callback` whenever `source` changes;
//    used here to save to localStorage after every edit.
//  - computed(...): a derived value that updates automatically. A computed
//    with get/set (see activePlaybookId below) can also be assigned to.
import { reactive, watch, computed } from 'vue'
import { registerSyncTarget, scheduleAutoSave } from './cloudSync.js'
import * as googleCloudStorage from '../services/gcsClient.js'
import * as localFolder from '../services/localFolder.js'
import { parsePlaybookXml, blankGuideline } from '../utils/xmlImport.js'
import { buildLlmInstructionsXml, downloadTextFile } from '../utils/xmlExport.js'

// The browser localStorage key every playbook is saved under.
const STORAGE_KEY = 'playbook-editor:playbooks:v1'

// "Heating and Hot Water" → "heating-and-hot-water" (used as a playbook id).
function slugify(text) {
  const slug = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'playbook'
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
  ;['guidelines', 'dialogConstraints', 'clarificationRules', 'escalations', 'routingCategories', 'steps'].forEach((listField) => {
    if (!Array.isArray(record[listField])) record[listField] = []
  })
  if (typeof record.clarificationRulesCondition !== 'string') record.clarificationRulesCondition = ''
  if (!Array.isArray(record.sectionOrder)) record.sectionOrder = []
  if (!record.sectionComments || typeof record.sectionComments !== 'object') record.sectionComments = {}
  if (typeof record.includeXmlDeclaration !== 'boolean') record.includeXmlDeclaration = true
  ;['globalNoMatch', 'globalNoInput'].forEach((repromptField) => {
    const currentReprompt = record[repromptField] || {}
    record[repromptField] = {
      ...blankGlobalReprompt(),
      ...currentReprompt,
      action: { ...blankGlobalReprompt().action, ...(currentReprompt.action || {}) }
    }
    if (record[repromptField].comment === undefined) delete record[repromptField].comment // exporter falls back to its default comment
  })
  record.guidelines = record.guidelines.map((guideline) => {
    const mergedGuideline = { ...blankGuideline(), ...guideline }
    if (!guideline.shape) {
      mergedGuideline.shape = guideline.rawXml?.trim()
        ? 'raw'
        : guideline.trigger?.trim() || guideline.action?.trim()
          ? 'structured'
          : 'text'
    }
    if (!Array.isArray(mergedGuideline.actionSteps)) mergedGuideline.actionSteps = []
    return mergedGuideline
  })
  record.escalations = record.escalations.map((escalation) => ({ comment: '', playbookNameParam: '', ...escalation }))
  record.clarificationRules = record.clarificationRules.map((rule) => ({ comment: '', instruction: '', ...rule }))
  record.routingCategories = record.routingCategories.map((category) => ({ comment: '', ...category }))
  return record
}

// A new, empty playbook with every field present.
function blankPlaybookRecord(id, name) {
  return {
    id,
    sourceObjectPath: '', // path of its file in the bucket, once it has one
    localFileName: '', // name of its file on this computer, once it has one
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

const STARTER_ID = 'untitled-playbook'
const STARTER_NAME = 'Untitled playbook'

// No data ships with the app: playbooks come from a Google Cloud Storage
// bucket (Cloud sync) or a local folder. Until one is loaded, a single
// blank playbook keeps the "there is always an active playbook" invariant
// every view relies on.
function defaultState() {
  const starterPlaybook = blankPlaybookRecord(STARTER_ID, STARTER_NAME)
  return {
    playbooks: [starterPlaybook],
    activePlaybookId: starterPlaybook.id
  }
}

// Reads the saved playbooks back from localStorage (or starts fresh).
function loadInitialState() {
  try {
    const savedJson = localStorage.getItem(STORAGE_KEY)
    if (savedJson) {
      const savedState = JSON.parse(savedJson)
      if (savedState && Array.isArray(savedState.playbooks) && savedState.playbooks.length) {
        savedState.playbooks.forEach(normalizeRecord)
        if (!savedState.playbooks.some((playbook) => playbook.id === savedState.activePlaybookId)) {
          savedState.activePlaybookId = savedState.playbooks[0].id
        }
        return savedState
      }
    }
  } catch (error) {
    console.warn('Could not read saved playbooks, starting with a blank playbook.', error)
  }
  return defaultState()
}

// THE shared state of this store: { playbooks: [...], activePlaybookId }.
const playbooksState = reactive(loadInitialState())

// After every change anywhere inside playbooksState (`deep: true` watches
// nested properties too), save everything to localStorage and let Cloud
// sync auto-save to the bucket if that's turned on.
watch(
  () => playbooksState,
  () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(playbooksState))
    } catch (error) {
      console.warn('Could not persist playbooks to localStorage.', error)
    }
    scheduleAutoSave()
  },
  { deep: true }
)

// "triage" → "triage", or "triage-2", "triage-3"... if that id is taken.
function uniqueId(baseId) {
  let candidateId = baseId
  let suffixNumber = 2
  while (playbooksState.playbooks.some((playbook) => playbook.id === candidateId)) {
    candidateId = `${baseId}-${suffixNumber}`
    suffixNumber += 1
  }
  return candidateId
}

/**
 * Internal accessor used by steps.js / playbook.js to read/write the
 * currently active playbook's nested data, without each of them holding
 * their own copy of state. Falls back to the first playbook if the active
 * ID is somehow stale (e.g. after a cloud load that dropped it).
 */
export function getActivePlaybookRecord() {
  let activeRecord = playbooksState.playbooks.find((playbook) => playbook.id === playbooksState.activePlaybookId)
  if (!activeRecord) {
    activeRecord = playbooksState.playbooks[0]
    if (activeRecord) playbooksState.activePlaybookId = activeRecord.id
  }
  return activeRecord
}

// ---------------------------------------------------------------------
// Google Cloud Storage sync — one .xml file per playbook, matching how the
// bucket is actually organized (e.g. "Heating and Hot Water.xml",
// "Water Taps.xml", one per playbook, in the bucket root or a folder).
// ---------------------------------------------------------------------

// Removes characters that aren't allowed in file names.
function sanitizeFileName(name) {
  const cleanedName = String(name || 'Untitled Playbook')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '')
  return cleanedName || 'Untitled Playbook'
}

// Guards against a common footgun: a prefix entered without its trailing
// slash (e.g. "flows" instead of "flows/") would otherwise get glued
// straight onto the filename ("flowsMyPlaybook.xml").
function normalizedPrefix(prefix) {
  const trimmedPrefix = (prefix || '').trim()
  if (!trimmedPrefix) return ''
  return trimmedPrefix.endsWith('/') ? trimmedPrefix : `${trimmedPrefix}/`
}

// "flows/" + "Triage" → "flows/Triage.xml"
function objectPathFor(prefix, fileNameWithoutExtension) {
  return `${normalizedPrefix(prefix)}${fileNameWithoutExtension}.xml`
}

// Builds a playbook record from a parsed XML file, giving it an id that
// isn't in `usedIds` yet (and adding it there).
// `origin` records where the file came from — { sourceObjectPath } for a
// bucket object, { localFileName } for a file in a local folder — so later
// saves overwrite that same file.
function playbookRecordFromParsed(fileName, parsedPlaybook, usedIds, origin) {
  const displayName = parsedPlaybook.playbookName || fileName.replace(/\.xml$/i, '')
  const baseId = slugify(displayName)
  let candidateId = baseId
  let suffixNumber = 2
  while (usedIds.has(candidateId)) {
    candidateId = `${baseId}-${suffixNumber}`
    suffixNumber += 1
  }
  usedIds.add(candidateId)
  const record = { id: candidateId, sourceObjectPath: '', localFileName: '', ...origin, playbookName: displayName }
  PARSED_FIELDS.forEach((fieldName) => {
    if (parsedPlaybook[fieldName] !== undefined) record[fieldName] = parsedPlaybook[fieldName]
  })
  return normalizeRecord(record)
}

// Replaces the local collection wholesale with what a bucket or folder
// load found. Leaves it untouched when nothing loaded.
function replaceCollection(newRecords) {
  if (!newRecords.length) return
  playbooksState.playbooks.splice(0, playbooksState.playbooks.length, ...newRecords)
  playbooksState.activePlaybookId = newRecords[0].id
}

/**
 * Lists every .xml object in the bucket (under `prefix`), parses each into
 * a playbook, and replaces the local collection wholesale. A file that
 * fails to parse is skipped (not fatal to the rest) and reported back.
 * @returns {Promise<{loadedCount: number, errors: Array<{name: string, message: string}>}>}
 */
async function loadAllFromBucket(bucket, prefix) {
  const bucketObjects = await googleCloudStorage.listObjects(bucket, normalizedPrefix(prefix), { delimiter: '/' })
  const xmlObjects = bucketObjects.filter((bucketObject) => bucketObject.name.toLowerCase().endsWith('.xml'))
  const usedIds = new Set()
  const loadedRecords = []
  const errors = []
  for (const xmlObject of xmlObjects) {
    try {
      const xmlText = await googleCloudStorage.readTextObject(bucket, xmlObject.name)
      if (xmlText === null) continue
      const parsedPlaybook = parsePlaybookXml(xmlText)
      const fileName = xmlObject.name.split('/').pop()
      loadedRecords.push(playbookRecordFromParsed(fileName, parsedPlaybook, usedIds, { sourceObjectPath: xmlObject.name }))
    } catch (error) {
      errors.push({ name: xmlObject.name, message: error.message })
    }
  }
  replaceCollection(loadedRecords)
  return { loadedCount: loadedRecords.length, errors }
}

async function saveOneRecordToBucket(bucket, prefix, record) {
  if (!record) return
  const objectPath = record.sourceObjectPath || objectPathFor(prefix, localFileNameFor(record).replace(/\.xml$/i, ''))
  const xmlText = buildLlmInstructionsXml(record, record.steps)
  await googleCloudStorage.writeTextObject(bucket, objectPath, xmlText)
  record.sourceObjectPath = objectPath
}

async function saveAllToBucket(bucket, prefix) {
  for (const record of playbooksState.playbooks) {
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
 * @param {{ pickFolder?: boolean }} options - pickFolder: choose a new folder first
 * @returns {Promise<{ fileName: string, folderName: string|null }>}
 */
async function saveActiveToLocalFolder({ pickFolder = false } = {}) {
  const activeRecord = getActivePlaybookRecord()
  if (!activeRecord) throw new Error('No active playbook to save.')
  const fileName = localFileNameFor(activeRecord)
  const xmlText = buildLlmInstructionsXml(activeRecord, activeRecord.steps)
  if (!localFolder.isSupported()) {
    downloadTextFile(fileName, xmlText)
    return { fileName, folderName: null }
  }
  if (pickFolder) await localFolder.chooseFolder()
  const folderName = await localFolder.writeTextFile(fileName, xmlText)
  activeRecord.localFileName = fileName
  return { fileName, folderName }
}

// True for the blank "Untitled playbook" the app starts with, while it's
// still untouched — opened files replace it rather than sitting beside it.
function isPristineStarter(record) {
  const allListsEmpty = ['guidelines', 'dialogConstraints', 'clarificationRules', 'escalations', 'routingCategories', 'steps']
    .every((listField) => !record[listField]?.length)
  const setupEmpty = Object.values(record.setup || {}).every((setupValue) => !setupValue)
  return (
    record.id === STARTER_ID &&
    record.playbookName === STARTER_NAME &&
    !record.sourceObjectPath &&
    !record.localFileName &&
    allListsEmpty &&
    setupEmpty &&
    !record.globalNoMatch?.prompt &&
    !record.globalNoInput?.prompt
  )
}

/**
 * Adds playbooks from .xml files the person picked on their computer. A
 * file whose name matches a loaded playbook's file (see localFileNameFor)
 * updates that playbook in place — keeping its id and bucket path — rather
 * than adding a duplicate; the rest are added as new playbooks. A file
 * that fails to parse is skipped and reported back. The first opened
 * playbook becomes active.
 * @param {Array<{ name: string, text: string }>} files
 * @param {{ confirmReplace?: (fileNames: string[]) => boolean }} options - asked
 *   before overwriting existing playbooks; returning false changes nothing
 * @returns {{ added: number, updated: number, errors: Array<{name: string, message: string}>, cancelled?: boolean }}
 */
function openLocalFiles(files, { confirmReplace } = {}) {
  // 1. Parse every file; collect the ones that fail.
  const errors = []
  const parsedFiles = []
  for (const file of files) {
    try {
      parsedFiles.push({ name: file.name, parsed: parsePlaybookXml(file.text) })
    } catch (error) {
      errors.push({ name: file.name, message: error.message })
    }
  }

  // 2. Split them into updates (file already loaded) and additions (new).
  const loadedPlaybookByFileName = new Map(
    playbooksState.playbooks.map((playbook) => [localFileNameFor(playbook).toLowerCase(), playbook])
  )
  const filesToUpdate = parsedFiles.filter((parsedFile) => loadedPlaybookByFileName.has(parsedFile.name.toLowerCase()))
  const filesToAdd = parsedFiles.filter((parsedFile) => !loadedPlaybookByFileName.has(parsedFile.name.toLowerCase()))
  if (filesToUpdate.length && confirmReplace && !confirmReplace(filesToUpdate.map((parsedFile) => parsedFile.name))) {
    return { added: 0, updated: 0, errors, cancelled: true }
  }

  // 3. Apply them. The untouched starter playbook is dropped first.
  if (filesToAdd.length && playbooksState.playbooks.length === 1 && isPristineStarter(playbooksState.playbooks[0])) {
    playbooksState.playbooks.splice(0, 1)
  }
  const usedIds = new Set(playbooksState.playbooks.map((playbook) => playbook.id))
  let firstOpenedId = null
  filesToUpdate.forEach(({ name, parsed }) => {
    const existingRecord = loadedPlaybookByFileName.get(name.toLowerCase())
    existingRecord.playbookName = parsed.playbookName || existingRecord.playbookName
    existingRecord.localFileName = name
    PARSED_FIELDS.forEach((fieldName) => {
      existingRecord[fieldName] = parsed[fieldName]
    })
    normalizeRecord(existingRecord)
    firstOpenedId = firstOpenedId || existingRecord.id
  })
  filesToAdd.forEach(({ name, parsed }) => {
    const newRecord = playbookRecordFromParsed(name, parsed, usedIds, { localFileName: name })
    playbooksState.playbooks.push(newRecord)
    firstOpenedId = firstOpenedId || newRecord.id
  })
  if (firstOpenedId) playbooksState.activePlaybookId = firstOpenedId
  return { added: filesToAdd.length, updated: filesToUpdate.length, errors }
}

// Hands Cloud sync the functions it needs to load/save playbooks, so
// cloudSync.js never has to import this file (that would be circular).
registerSyncTarget('playbooks', {
  loadAll: loadAllFromBucket,
  saveAll: saveAllToBucket,
  saveOne: saveActiveToBucket
})

/**
 * What components call to use this store, e.g.
 *   const playbooksStore = usePlaybooksStore()
 *   playbooksStore.playbooks.value   // the list of playbooks
 * Values are returned as computed refs, so read them with `.value` in
 * script code (templates unwrap `.value` automatically only for
 * top-level refs — which is why templates here still write `.value`).
 */
export function usePlaybooksStore() {
  const playbooks = computed(() => playbooksState.playbooks)

  // A computed with a getter and a setter: reading gives the active id,
  // assigning switches the active playbook (ignoring unknown ids).
  const activePlaybookId = computed({
    get: () => playbooksState.activePlaybookId,
    set: (newActiveId) => {
      if (playbooksState.playbooks.some((playbook) => playbook.id === newActiveId)) {
        playbooksState.activePlaybookId = newActiveId
      }
    }
  })

  const activePlaybook = computed(() => getActivePlaybookRecord())

  function setActivePlaybookId(playbookId) {
    activePlaybookId.value = playbookId
  }

  function createPlaybook(name) {
    const trimmedName = (name || '').trim()
    if (!trimmedName) throw new Error('A playbook name is required.')
    const newId = uniqueId(slugify(trimmedName))
    const newRecord = blankPlaybookRecord(newId, trimmedName)
    playbooksState.playbooks.push(newRecord)
    playbooksState.activePlaybookId = newId
    return newRecord
  }

  function renamePlaybook(playbookId, newName) {
    const record = playbooksState.playbooks.find((playbook) => playbook.id === playbookId)
    if (!record) throw new Error(`Playbook "${playbookId}" not found.`)
    const trimmedName = (newName || '').trim()
    if (!trimmedName) throw new Error('A playbook name is required.')
    record.playbookName = trimmedName
  }

  function duplicatePlaybook(playbookId) {
    const sourceRecord = playbooksState.playbooks.find((playbook) => playbook.id === playbookId)
    if (!sourceRecord) throw new Error(`Playbook "${playbookId}" not found.`)
    // JSON round-trip = a deep copy, so editing the copy never touches the original.
    const copiedRecord = JSON.parse(JSON.stringify(sourceRecord))
    copiedRecord.id = uniqueId(slugify(`${sourceRecord.playbookName}-copy`))
    copiedRecord.playbookName = `${sourceRecord.playbookName} (copy)`
    copiedRecord.sourceObjectPath = '' // must save to its own new files, never the source's
    copiedRecord.localFileName = ''
    playbooksState.playbooks.push(copiedRecord)
    playbooksState.activePlaybookId = copiedRecord.id
    return copiedRecord
  }

  // Parses XML and overwrites the currently active playbook's content in
  // place (keeping its id and, if it has one, its bucket sourceObjectPath —
  // so a later save still overwrites the same file) rather than creating a
  // new playbook.
  function replaceActivePlaybookFromXml(xmlText) {
    const parsedPlaybook = parsePlaybookXml(xmlText)
    const activeRecord = getActivePlaybookRecord()
    if (!activeRecord) throw new Error('No active playbook to import into.')
    activeRecord.playbookName = parsedPlaybook.playbookName || activeRecord.playbookName
    PARSED_FIELDS.forEach((fieldName) => {
      activeRecord[fieldName] = parsedPlaybook[fieldName]
    })
    normalizeRecord(activeRecord)
    return activeRecord
  }

  function deletePlaybook(playbookId) {
    if (playbooksState.playbooks.length <= 1) throw new Error('At least one playbook must remain.')
    const playbookIndex = playbooksState.playbooks.findIndex((playbook) => playbook.id === playbookId)
    if (playbookIndex === -1) return
    playbooksState.playbooks.splice(playbookIndex, 1)
    if (playbooksState.activePlaybookId === playbookId) {
      playbooksState.activePlaybookId = playbooksState.playbooks[0].id
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
    replaceActivePlaybookFromXml,
    saveActiveToLocalFolder,
    openLocalFiles
  }
}
