// Parses a single <LLM_INSTRUCTIONS> XML document (one playbook, one file)
// back into the app's internal shape: { playbookName, setup, guidelines,
// dialogConstraints, clarificationRules, escalations, steps }. Mirrors
// src/utils/xmlExport.js's buildLlmInstructionsXml in reverse.
//
// Uses the browser's native DOMParser — this module only works client-side.

let uid = 0
const nextId = (prefix) => `${prefix}${Date.now()}_${++uid}`

function textOf(el) {
  return el ? (el.textContent || '').trim() : ''
}

function attr(el, name) {
  return el ? el.getAttribute(name) || '' : ''
}

function firstChild(parent, tagName) {
  if (!parent) return null
  for (const child of parent.children) {
    if (child.tagName === tagName) return child
  }
  return null
}

function children(parent, tagName) {
  if (!parent) return []
  return Array.from(parent.children).filter((c) => c.tagName === tagName)
}

// Collects the XML comment(s) that sit immediately before `el` (skipping
// whitespace-only text nodes), oldest first, and joins them with a blank
// line — the reverse of xmlExport.js's buildCommentBlock, which splits a
// `comment` field on blank lines into separate stacked <!-- --> blocks.
// Each comment's own internal line breaks are preserved as written.
function collectPrecedingComments(el) {
  if (!el) return ''
  const found = []
  let node = el.previousSibling
  while (node) {
    if (node.nodeType === 8) {
      // Comment node
      const cleaned = node.textContent
        .split('\n')
        .map((l) => l.trim())
        .join('\n')
        .trim()
      if (cleaned) found.unshift(cleaned)
    } else if (node.nodeType === 3 && node.textContent.trim() === '') {
      // whitespace-only text node between elements — keep looking further back
    } else {
      break
    }
    node = node.previousSibling
  }
  return found.join('\n\n')
}

// Serializes an element's children verbatim (for the rawXml escape hatch),
// then strips the source document's indentation so the result is the same
// left-aligned text the exporter re-indents. Without the dedent, every
// import → export cycle would push raw policy bodies further right.
function serializeChildrenXml(el) {
  const serializer = new XMLSerializer()
  const raw = Array.from(el.childNodes)
    .map((n) => serializer.serializeToString(n))
    .join('')
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  while (lines.length && !lines[0].trim()) lines.shift()
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  if (!lines.length) return ''
  // The first line's indent was eaten by the parent's opening tag, so
  // measure the common indent from the remaining non-blank lines.
  lines[0] = lines[0].trimStart()
  const indents = lines
    .slice(1)
    .filter((l) => l.trim())
    .map((l) => l.match(/^[ \t]*/)[0].length)
  const common = indents.length ? Math.min(...indents) : 0
  // Nested lines are one level deeper than the first line's siblings, so
  // keep the relative depth by dedenting by the smallest indent among
  // lines that start a sibling tag at the first line's level.
  const siblingIndents = lines
    .slice(1)
    .filter((l) => /^\s*<(?!\/)/.test(l) || /^\s*<\//.test(l))
    .map((l) => l.match(/^[ \t]*/)[0].length)
  const base = siblingIndents.length ? Math.min(...siblingIndents) : common
  return lines
    .map((l, i) => (i === 0 ? l : l.slice(Math.min(base, l.match(/^[ \t]*/)[0].length))).trimEnd())
    .join('\n')
}

// Normalizes hand-wrapped prose from the source XML: every line is trimmed
// and soft-wrapped lines are re-joined with a single space, so the editor
// shows "one sentence" instead of the source file's indentation. Blank lines
// (paragraph breaks) and lines that start a bullet / numbered item keep
// their line break, so structured text still round-trips.
const BULLET_RE = /^([-*\u2022]|\d+[.)])\s/
export function prose(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim())
  const out = []
  let blankPending = false
  lines.forEach((line) => {
    if (!line) {
      if (out.length) blankPending = true
      return
    }
    if (!out.length) {
      out.push(line)
    } else if (blankPending) {
      out.push('', line)
    } else if (BULLET_RE.test(line)) {
      out.push(line)
    } else {
      out[out.length - 1] = `${out[out.length - 1]} ${line}`
    }
    blankPending = false
  })
  return out.join('\n').trim()
}

function proseOf(el) {
  return el ? prose(el.textContent || '') : ''
}

// Top-level section tag → the key used by sectionOrder / sectionComments.
// Both clarification wrapper styles map to the same logical section.
const SECTION_KEY_BY_TAG = {
  SETUP: 'SETUP',
  GUIDELINES: 'GUIDELINES',
  DIALOG_CONSTRAINTS: 'DIALOG_CONSTRAINTS',
  CLARIFICATION_RULES: 'CLARIFICATION_RULES',
  CLARIFICATION_RULES_POLICY: 'CLARIFICATION_RULES',
  ESCALATION_HANDLING: 'ESCALATION_HANDLING',
  ROUTING_LOGIC: 'ROUTING_LOGIC',
  DIAGNOSTIC_FLOWS: 'DIAGNOSTIC_FLOWS'
}

// Records which top-level sections the document contains (in document
// order) and the XML comment sitting directly above each one, e.g.
// "<!-- STEP 1: CLARIFY AMBIGUOUS INPUTS -->", so export reproduces both.
function parseDocumentLayout(root) {
  const sectionOrder = []
  const sectionComments = {}
  Array.from(root.children).forEach((el) => {
    const key = SECTION_KEY_BY_TAG[el.tagName]
    if (!key || sectionOrder.includes(key)) return
    sectionOrder.push(key)
    sectionComments[key] = prose(collectPrecedingComments(el))
  })
  return { sectionOrder, sectionComments }
}

// ---------------------------------------------------------------------
// SETUP — CONTEXT_HANDLING (instruction/constraint) and ROLE/OBJECTIVE are
// two different styles seen in the wild; a playbook may use either (or, in
// principle, both) so both are always parsed.
// ---------------------------------------------------------------------
function parseSetup(root) {
  const setupEl = firstChild(root, 'SETUP')
  let playbookName = ''
  if (setupEl) {
    const paramEl = Array.from(setupEl.children).find(
      (c) => c.tagName === 'PARAMETER_ASSIGNMENT' && attr(c, 'name') === 'param_playbook_name'
    )
    playbookName = paramEl ? attr(paramEl, 'value') : ''
  }
  const ctxEl = firstChild(setupEl, 'CONTEXT_HANDLING')
  return {
    playbookName,
    setup: {
      contextInstruction: textOf(firstChild(ctxEl, 'INSTRUCTION')),
      contextConstraint: textOf(firstChild(ctxEl, 'CONSTRAINT')),
      role: proseOf(firstChild(setupEl, 'ROLE')),
      objective: proseOf(firstChild(setupEl, 'OBJECTIVE'))
    }
  }
}

// ---------------------------------------------------------------------
// GUIDELINES — a POLICY is one of three shapes:
//  - 'text'       plain one-liner: <POLICY id="FOCUS">...</POLICY>
//  - 'structured' any mix of TRIGGER / TRIGGER_KEYWORDS / ACTION /
//                 REQUIREMENT / FORMAT, where ACTION is either plain text
//                 or a list of <SET_PARAMETER>/<INVOKE_FLOW> steps (covers
//                 CANCELLATION_OVERRIDE and HANDOFF_SUMMARY in Triage.xml)
//  - 'raw'        anything else, kept verbatim as rawXml
// ---------------------------------------------------------------------
const STRUCTURED_POLICY_TAGS = new Set(['TRIGGER', 'TRIGGER_KEYWORDS', 'ACTION', 'REQUIREMENT', 'FORMAT'])
const ACTION_STEP_TAGS = new Set(['SET_PARAMETER', 'INVOKE_FLOW'])

export function blankGuideline() {
  return {
    id: '',
    policyId: '',
    shape: 'text',
    comment: '',
    text: '',
    trigger: '',
    triggerKeywords: '',
    action: '',
    actionSteps: [],
    requirement: '',
    format: '',
    rawXml: ''
  }
}

function stripFlowRef(value) {
  const m = String(value || '').match(/^\$\{FLOW:([^}]+)\}$/)
  return m ? m[1] : String(value || '')
}

function parseActionSteps(actionEl) {
  return Array.from(actionEl.children).map((stepEl) => ({
    id: nextId('as'),
    kind: stepEl.tagName,
    name: stepEl.tagName === 'INVOKE_FLOW' ? stripFlowRef(attr(stepEl, 'name')) : attr(stepEl, 'name'),
    value: attr(stepEl, 'value')
  }))
}

function parseGuideline(policyEl) {
  const base = { ...blankGuideline(), id: nextId('g'), policyId: attr(policyEl, 'id'), comment: prose(collectPrecedingComments(policyEl)) }
  const kids = Array.from(policyEl.children)
  if (kids.length === 0) {
    return { ...base, shape: 'text', text: proseOf(policyEl) }
  }
  const actionEl = firstChild(policyEl, 'ACTION')
  const actionKids = actionEl ? Array.from(actionEl.children) : []
  const actionOk = !actionEl || actionKids.every((c) => ACTION_STEP_TAGS.has(c.tagName) && c.children.length === 0)
  const uniqueTags = new Set(kids.map((c) => c.tagName))
  const structured = actionOk && uniqueTags.size === kids.length && kids.every((c) => STRUCTURED_POLICY_TAGS.has(c.tagName))
  if (structured) {
    const actionIsSteps = actionKids.length > 0
    return {
      ...base,
      shape: 'structured',
      trigger: proseOf(firstChild(policyEl, 'TRIGGER')),
      triggerKeywords: proseOf(firstChild(policyEl, 'TRIGGER_KEYWORDS')),
      action: actionEl && !actionIsSteps ? proseOf(actionEl) : '',
      actionSteps: actionIsSteps ? parseActionSteps(actionEl) : [],
      requirement: proseOf(firstChild(policyEl, 'REQUIREMENT')),
      format: proseOf(firstChild(policyEl, 'FORMAT'))
    }
  }
  return { ...base, shape: 'raw', rawXml: serializeChildrenXml(policyEl) }
}

function parseGuidelines(root) {
  return children(firstChild(root, 'GUIDELINES'), 'POLICY').map(parseGuideline)
}

// ---------------------------------------------------------------------
// DIALOG_CONSTRAINTS
// ---------------------------------------------------------------------
function parseDialogConstraint(constraintEl) {
  const type = attr(constraintEl, 'type')
  const criticalEl = firstChild(constraintEl, 'CRITICAL')
  if (criticalEl) {
    return {
      id: nextId('dc'),
      type,
      text: '',
      critical: textOf(criticalEl),
      action: textOf(firstChild(constraintEl, 'ACTION'))
    }
  }
  return { id: nextId('dc'), type, text: textOf(constraintEl), critical: '', action: '' }
}

function parseDialogConstraints(root) {
  return children(firstChild(root, 'DIALOG_CONSTRAINTS'), 'CONSTRAINT').map(parseDialogConstraint)
}

// ---------------------------------------------------------------------
// CLARIFICATION RULES — two wrapper styles seen in the wild:
//  - <CLARIFICATION_RULES_POLICY><RULE condition="...">...</RULE>...</CLARIFICATION_RULES_POLICY>
//  - <CLARIFICATION_RULES condition="..."><RULE keyword="...">...</RULE>...</CLARIFICATION_RULES>
// ---------------------------------------------------------------------
function parseClarificationRule(ruleEl) {
  const hasKeyword = ruleEl.getAttribute && ruleEl.getAttribute('keyword') !== null
  return {
    id: nextId('cr'),
    attrName: hasKeyword ? 'keyword' : 'condition',
    condition: hasKeyword ? attr(ruleEl, 'keyword') : attr(ruleEl, 'condition'),
    prompt: proseOf(firstChild(ruleEl, 'PROMPT')),
    // Optional per-rule routing/handling note seen alongside PROMPT in some
    // rules (e.g. "if unsure, route to the Generic Leaks playbook").
    instruction: proseOf(firstChild(ruleEl, 'INSTRUCTION')),
    comment: prose(collectPrecedingComments(ruleEl))
  }
}

function parseClarificationRules(root) {
  const wrapperRules = firstChild(root, 'CLARIFICATION_RULES') // triage-style outer wrapper
  const wrapperPolicy = firstChild(root, 'CLARIFICATION_RULES_POLICY') // this app's own simple wrapper
  const wrapper = wrapperRules || wrapperPolicy
  if (!wrapper) {
    return { clarificationRules: [], clarificationRulesCondition: '' }
  }
  return {
    clarificationRules: children(wrapper, 'RULE').map(parseClarificationRule),
    clarificationRulesCondition: wrapperRules ? attr(wrapperRules, 'condition') : ''
  }
}

// ---------------------------------------------------------------------
// ESCALATION_HANDLING
// ---------------------------------------------------------------------
function parseEscalation(escEl, playbookName) {
  const actionEl = firstChild(escEl, 'ACTION')
  let escalationReason = ''
  let playbookNameParam = ''
  let flowName = ''
  let note = ''
  if (actionEl) {
    const createEl = firstChild(actionEl, 'create_json_data_object')
    if (createEl) {
      escalationReason = attr(createEl, 'param_escalation_reason')
      // Blank means "use the playbook's own name" (what the exporter falls
      // back to), so renaming the playbook keeps escalations in step. Only
      // a value that differs from the playbook name is stored explicitly.
      const pn = attr(createEl, 'param_playbook_name')
      playbookNameParam = pn && pn !== playbookName ? pn : ''
    }
    const invokeEl = firstChild(actionEl, 'INVOKE_FLOW')
    if (invokeEl) {
      const nameAttr = attr(invokeEl, 'name')
      const m = nameAttr.match(/\$\{FLOW:([^}]+)\}/)
      flowName = m ? m[1] : nameAttr
      // The exporter writes escalation notes as "<!-- Note: <text> -->";
      // strip that prefix back off to recover the original `note` field.
      note = prose(collectPrecedingComments(invokeEl).replace(/^Note:\s*/, ''))
    }
  }
  // Seen with either attribute name in the wild ("condition" or "type") —
  // whichever is present is preserved via attrName so export round-trips it.
  const hasType = escEl.getAttribute && escEl.getAttribute('type') !== null
  return {
    id: nextId('esc'),
    attrName: hasType ? 'type' : 'condition',
    condition: hasType ? attr(escEl, 'type') : attr(escEl, 'condition'),
    // e.g. "<!-- Gas Emergency -->" sitting directly above the <ESCALATION>
    comment: prose(collectPrecedingComments(escEl)),
    description: proseOf(firstChild(escEl, 'DESCRIPTION')),
    trigger: proseOf(firstChild(escEl, 'TRIGGER')),
    escalationReason,
    playbookNameParam,
    flowName,
    note
  }
}

function parseEscalations(root, playbookName) {
  return children(firstChild(root, 'ESCALATION_HANDLING'), 'ESCALATION').map((el) => parseEscalation(el, playbookName))
}

// Global (playbook-level) NoMatch/NoInput reprompt logic — modeled the same
// way as a classification's <Action> (see parseClassificationAction below,
// reused directly here) so tool_type/tool_id/Parameter are genuine,
// independently editable fields rather than hardcoded boilerplate.
function parseGlobalReprompt(handlerEl) {
  const actionEl = firstChild(handlerEl, 'Action')
  return {
    comment: prose(collectPrecedingComments(handlerEl)),
    prompt: proseOf(firstChild(handlerEl, 'PROMPT')),
    action: actionEl ? parseClassificationAction(actionEl) : { toolType: '', toolId: '', flowId: '', parameterName: '', parameterValue: '' }
  }
}

function parseGlobalReprompts(root) {
  const ehEl = firstChild(firstChild(root, 'ESCALATION_HANDLING'), 'EVENT_HANDLERS')
  const noMatchEl = firstChild(ehEl, 'NO_MATCH')
  const noInputEl = firstChild(ehEl, 'NO_INPUT')
  return {
    globalNoMatch: noMatchEl
      ? parseGlobalReprompt(noMatchEl)
      : { prompt: '', action: { toolType: '', toolId: '', flowId: '', parameterName: '', parameterValue: '' } },
    globalNoInput: noInputEl
      ? parseGlobalReprompt(noInputEl)
      : { prompt: '', action: { toolType: '', toolId: '', flowId: '', parameterName: '', parameterValue: '' } }
  }
}

// ---------------------------------------------------------------------
// ROUTING_LOGIC — a router/triage playbook's equivalent of DIAGNOSTIC_FLOWS:
// routes to other playbooks by name rather than asking its own questions.
// ---------------------------------------------------------------------
function parseRoutingCategory(catEl) {
  return {
    id: nextId('rc'),
    name: attr(catEl, 'name'),
    comment: prose(collectPrecedingComments(catEl)),
    triggers: proseOf(firstChild(catEl, 'TRIGGERS')),
    action: proseOf(firstChild(catEl, 'ACTION'))
  }
}

function parseRoutingLogic(root) {
  return children(firstChild(root, 'ROUTING_LOGIC'), 'CATEGORY').map(parseRoutingCategory)
}

// ---------------------------------------------------------------------
// DIAGNOSTIC_FLOWS
// ---------------------------------------------------------------------
function parseClassificationAction(actionEl) {
  const toolType = attr(actionEl, 'tool_type')
  const toolId = attr(actionEl, 'tool_id')
  const flowId = attr(actionEl, 'flow_id')
  let parameterName = attr(actionEl, 'parameter_name')
  let parameterValue = attr(actionEl, 'value')
  const paramEl = firstChild(actionEl, 'Parameter')
  if (paramEl) {
    parameterName = attr(paramEl, 'name')
    parameterValue = textOf(paramEl)
  }
  return { id: nextId('a'), toolType, toolId, flowId, parameterName, parameterValue }
}

function parseClassification(clsEl) {
  const comment = collectPrecedingComments(clsEl)
  let query = ''
  const actions = []
  Array.from(clsEl.children).forEach((child) => {
    if (child.tagName === 'Parameter' && attr(child, 'name') === 'query') {
      query = textOf(child)
    } else if (child.tagName === 'Action') {
      actions.push(parseClassificationAction(child))
    }
  })
  return {
    id: nextId('c'),
    classificationId: attr(clsEl, 'ID'),
    nextStep: attr(clsEl, 'next_step'),
    triggerCondition: textOf(firstChild(clsEl, 'TriggerCondition')),
    query,
    dialogResponse: textOf(firstChild(clsEl, 'DialogResponse')),
    comment,
    actions
  }
}

function parseEventHandlers(agentInteractionEl) {
  const ehEl = firstChild(agentInteractionEl, 'EventHandlers')
  return {
    noMatchResponse: textOf(firstChild(firstChild(ehEl, 'NoMatch'), 'DialogResponse')),
    noInputResponse: textOf(firstChild(firstChild(ehEl, 'NoInput'), 'DialogResponse'))
  }
}

function parseDialogStep(stepEl) {
  const comment = collectPrecedingComments(stepEl)
  const agentInteractionEl = firstChild(stepEl, 'AgentInteraction')
  const promptEl = firstChild(agentInteractionEl, 'Prompt')
  // Normally a sibling of AgentInteraction, but tolerate it being nested
  // inside AgentInteraction too (seen in hand-edited source documents).
  const instructionsEl =
    firstChild(stepEl, 'DialogStepSpecificInstructions') || firstChild(agentInteractionEl, 'DialogStepSpecificInstructions')
  const { noMatchResponse, noInputResponse } = parseEventHandlers(agentInteractionEl)
  return {
    id: attr(stepEl, 'ID'),
    topic: attr(stepEl, 'topic'),
    issueSummary: textOf(firstChild(stepEl, 'IssueSummary')),
    instructions: instructionsEl ? textOf(instructionsEl) : '',
    comment,
    promptType: attr(promptEl, 'type') || 'InitialQuery',
    promptComment: promptEl ? collectPrecedingComments(promptEl) : '',
    prompt: textOf(promptEl),
    noMatchResponse,
    noInputResponse,
    classifications: children(firstChild(stepEl, 'ExpectedClassifications'), 'Classification').map(parseClassification)
  }
}

function parseSteps(flowsRoot) {
  return children(flowsRoot, 'DIALOG_STEP').map(parseDialogStep)
}

/**
 * Parses one playbook XML document into the app's internal playbook shape.
 * Accepts either a full <LLM_INSTRUCTIONS> document (playbook config +
 * steps) or a bare <DIAGNOSTIC_FLOWS> document (steps only — the config
 * fields come back blank). Every nested record (steps, classifications,
 * actions, guidelines, ...) is already assigned a fresh unique `id`.
 * @param {string} xmlText
 * @returns {{playbookName: string, setup: object, guidelines: Array, dialogConstraints: Array, clarificationRules: Array, escalations: Array, steps: Array}}
 */
export function parsePlaybookXml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
  const parserError = doc.querySelector('parsererror')
  if (parserError) {
    throw new Error(`Not valid XML: ${parserError.textContent.trim().slice(0, 200)}`)
  }
  const root = doc.documentElement
  if (!root || (root.tagName !== 'LLM_INSTRUCTIONS' && root.tagName !== 'DIAGNOSTIC_FLOWS')) {
    throw new Error('Expected a root <LLM_INSTRUCTIONS> (or bare <DIAGNOSTIC_FLOWS>) element.')
  }

  const includeXmlDeclaration = /^\s*(\uFEFF)?\s*<\?xml/.test(xmlText)

  if (root.tagName === 'DIAGNOSTIC_FLOWS') {
    return {
      includeXmlDeclaration,
      sectionOrder: [],
      sectionComments: {},
      playbookName: '',
      setup: { contextInstruction: '', contextConstraint: '', role: '', objective: '' },
      guidelines: [],
      dialogConstraints: [],
      clarificationRules: [],
      clarificationRulesCondition: '',
      escalations: [],
      globalNoMatch: { prompt: '', action: { toolType: '', toolId: '', flowId: '', parameterName: '', parameterValue: '' } },
      globalNoInput: { prompt: '', action: { toolType: '', toolId: '', flowId: '', parameterName: '', parameterValue: '' } },
      routingCategories: [],
      steps: parseSteps(root)
    }
  }

  const { playbookName, setup } = parseSetup(root)
  const { clarificationRules, clarificationRulesCondition } = parseClarificationRules(root)
  const { globalNoMatch, globalNoInput } = parseGlobalReprompts(root)
  const { sectionOrder, sectionComments } = parseDocumentLayout(root)
  return {
    playbookName,
    includeXmlDeclaration,
    sectionOrder,
    sectionComments,
    setup,
    guidelines: parseGuidelines(root),
    dialogConstraints: parseDialogConstraints(root),
    clarificationRules,
    clarificationRulesCondition,
    escalations: parseEscalations(root, playbookName),
    globalNoMatch,
    globalNoInput,
    routingCategories: parseRoutingLogic(root),
    steps: parseSteps(firstChild(root, 'DIAGNOSTIC_FLOWS'))
  }
}

/**
 * Tries to turn a policy's raw XML body (the `rawXml` escape hatch) into
 * the structured shape — TRIGGER / TRIGGER_KEYWORDS / ACTION (text or
 * SET_PARAMETER/INVOKE_FLOW steps) / REQUIREMENT / FORMAT. Used by the
 * editor's "Convert to fields" button, e.g. for a CANCELLATION_OVERRIDE
 * saved by an older version of the app. Returns null (and leaves the
 * caller's data alone) if the body doesn't fit the structured shape or
 * isn't well-formed.
 * @param {string} rawXml
 * @returns {object|null} guideline fields (no id / policyId)
 */
export function structurePolicyBody(rawXml) {
  try {
    const doc = new DOMParser().parseFromString(`<POLICY>${rawXml || ''}</POLICY>`, 'application/xml')
    if (doc.querySelector('parsererror')) return null
    const parsed = parseGuideline(doc.documentElement)
    if (parsed.shape !== 'structured') return null
    const { id, policyId, comment, ...fields } = parsed
    return { ...fields, rawXml: '' }
  } catch (e) {
    return null
  }
}
