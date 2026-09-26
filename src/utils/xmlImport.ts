// Parses a single <LLM_INSTRUCTIONS> XML document (one playbook, one file)
// back into the app's internal shape: { playbookName, setup, guidelines,
// dialogConstraints, clarificationRules, escalations, steps }. Mirrors
// src/utils/xmlExport.js's buildLlmInstructionsXml in reverse.
//
// Uses the browser's native DOMParser — this module only works client-side.

import type {
  Action,
  ActionStep,
  ClarificationRule,
  Classification,
  DialogConstraint,
  Escalation,
  GlobalReprompt,
  Guideline,
  ParsedPlaybook,
  RoutingCategory,
  SectionKey,
  Setup,
  Step
} from '../types'

// Plain TypeScript — no Vue in this file. Types (Element, Step, ...) after a
// colon describe what a parameter or return value holds; `Element` is the
// browser's type for one XML/HTML element.

let generatedIdCounter = 0
const generateId = (prefix: string): string => `${prefix}${Date.now()}_${++generatedIdCounter}`

function textOf(element: Element | null): string {
  return element ? (element.textContent || '').trim() : ''
}

function attributeValue(element: Element | null, name: string): string {
  return element ? element.getAttribute(name) || '' : ''
}

function firstChildByTag(parent: Element | null, tagName: string): Element | null {
  if (!parent) return null
  for (const child of parent.children) {
    if (child.tagName === tagName) return child
  }
  return null
}

function childElementsByTag(parent: Element | null, tagName: string): Element[] {
  if (!parent) return []
  return Array.from(parent.children).filter((childElement) => childElement.tagName === tagName)
}

// Collects the XML comment(s) that sit immediately before `el` (skipping
// whitespace-only text nodes), oldest first, and joins them with a blank
// line — the reverse of xmlExport.js's buildCommentBlock, which splits a
// `comment` field on blank lines into separate stacked <!-- --> blocks.
// Each comment's own internal line breaks are preserved as written.
function collectPrecedingComments(element: Element | null): string {
  if (!element) return ''
  const comments = []
  let node = element.previousSibling
  while (node) {
    if (node.nodeType === 8) {
      // Comment node
      const commentText = node.textContent
        .split('\n')
        .map((line) => line.trim())
        .join('\n')
        .trim()
      if (commentText) comments.unshift(commentText)
    } else if (node.nodeType === 3 && node.textContent.trim() === '') {
      // whitespace-only text node between elements — keep looking further back
    } else {
      break
    }
    node = node.previousSibling
  }
  return comments.join('\n\n')
}

// Serializes an element's children verbatim (for the rawXml escape hatch),
// then strips the source document's indentation so the result is the same
// left-aligned text the exporter re-indents. Without the dedent, every
// import → export cycle would push raw policy bodies further right.
function serializeChildrenXml(element: Element): string {
  const serializer = new XMLSerializer()
  const serializedXml = Array.from(element.childNodes)
    .map((childNode) => serializer.serializeToString(childNode))
    .join('')
  const lines = serializedXml.replace(/\r\n/g, '\n').split('\n')
  while (lines.length && !lines[0].trim()) lines.shift()
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  if (!lines.length) return ''
  // The first line's indent was eaten by the parent's opening tag, so
  // measure the common indent from the remaining non-blank lines.
  lines[0] = lines[0].trimStart()
  const lineIndents = lines
    .slice(1)
    .filter((line) => line.trim())
    .map((line) => line.match(/^[ \t]*/)[0].length)
  const commonIndent = lineIndents.length ? Math.min(...lineIndents) : 0
  // Nested lines are one level deeper than the first line's siblings, so
  // keep the relative depth by dedenting by the smallest indent among
  // lines that start a sibling tag at the first line's level.
  const siblingIndents = lines
    .slice(1)
    .filter((line) => /^\s*<(?!\/)/.test(line) || /^\s*<\//.test(line))
    .map((line) => line.match(/^[ \t]*/)[0].length)
  const dedentAmount = siblingIndents.length ? Math.min(...siblingIndents) : commonIndent
  return lines
    .map((line, lineIndex) => (lineIndex === 0 ? line : line.slice(Math.min(dedentAmount, line.match(/^[ \t]*/)[0].length))).trimEnd())
    .join('\n')
}

// Normalizes hand-wrapped prose from the source XML: every line is trimmed
// and soft-wrapped lines are re-joined with a single space, so the editor
// shows "one sentence" instead of the source file's indentation. Blank lines
// (paragraph breaks) and lines that start a bullet / numbered item keep
// their line break, so structured text still round-trips.
const BULLET_RE = /^([-*\u2022]|\d+[.)])\s/
export function prose(text: string | null | undefined): string {
  const lines = String(text ?? '').split(/\r?\n/).map((line) => line.trim())
  const joinedLines = []
  let hadBlankLine = false
  lines.forEach((line) => {
    if (!line) {
      if (joinedLines.length) hadBlankLine = true
      return
    }
    if (!joinedLines.length) {
      joinedLines.push(line)
    } else if (hadBlankLine) {
      joinedLines.push('', line)
    } else if (BULLET_RE.test(line)) {
      joinedLines.push(line)
    } else {
      joinedLines[joinedLines.length - 1] = `${joinedLines[joinedLines.length - 1]} ${line}`
    }
    hadBlankLine = false
  })
  return joinedLines.join('\n').trim()
}

function proseOf(element: Element | null): string {
  return element ? prose(element.textContent || '') : ''
}

// Top-level section tag → the key used by sectionOrder / sectionComments.
// Both clarification wrapper styles map to the same logical section.
const SECTION_KEY_BY_TAG: Record<string, SectionKey> = {
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
function parseDocumentLayout(rootElement: Element): Pick<ParsedPlaybook, 'sectionOrder' | 'sectionComments'> {
  const sectionOrder: SectionKey[] = []
  const sectionComments: ParsedPlaybook['sectionComments'] = {}
  Array.from(rootElement.children).forEach((sectionElement) => {
    const sectionKey = SECTION_KEY_BY_TAG[sectionElement.tagName]
    if (!sectionKey || sectionOrder.includes(sectionKey)) return
    sectionOrder.push(sectionKey)
    sectionComments[sectionKey] = prose(collectPrecedingComments(sectionElement))
  })
  return { sectionOrder, sectionComments }
}

// ---------------------------------------------------------------------
// SETUP — CONTEXT_HANDLING (instruction/constraint) and ROLE/OBJECTIVE are
// two different styles seen in the wild; a playbook may use either (or, in
// principle, both) so both are always parsed.
// ---------------------------------------------------------------------
function parseSetup(rootElement: Element): { playbookName: string; setup: Setup } {
  const setupElement = firstChildByTag(rootElement, 'SETUP')
  let playbookName = ''
  if (setupElement) {
    const playbookNameParamElement = Array.from(setupElement.children).find(
      (childElement) => childElement.tagName === 'PARAMETER_ASSIGNMENT' && attributeValue(childElement, 'name') === 'param_playbook_name'
    )
    playbookName = playbookNameParamElement ? attributeValue(playbookNameParamElement, 'value') : ''
  }
  const contextHandlingElement = firstChildByTag(setupElement, 'CONTEXT_HANDLING')
  return {
    playbookName,
    setup: {
      contextInstruction: textOf(firstChildByTag(contextHandlingElement, 'INSTRUCTION')),
      contextConstraint: textOf(firstChildByTag(contextHandlingElement, 'CONSTRAINT')),
      role: proseOf(firstChildByTag(setupElement, 'ROLE')),
      objective: proseOf(firstChildByTag(setupElement, 'OBJECTIVE'))
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

export function blankGuideline(): Guideline {
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

function stripFlowRef(value: string): string {
  const match = String(value || '').match(/^\$\{FLOW:([^}]+)\}$/)
  return match ? match[1] : String(value || '')
}

function parseActionSteps(actionElement: Element): ActionStep[] {
  return Array.from(actionElement.children).map((stepElement) => ({
    id: generateId('as'),
    kind: stepElement.tagName,
    name: stepElement.tagName === 'INVOKE_FLOW' ? stripFlowRef(attributeValue(stepElement, 'name')) : attributeValue(stepElement, 'name'),
    value: attributeValue(stepElement, 'value')
  }))
}

function parseGuideline(policyElement: Element): Guideline {
  const baseGuideline: Guideline = { ...blankGuideline(), id: generateId('g'), policyId: attributeValue(policyElement, 'id'), comment: prose(collectPrecedingComments(policyElement)) }
  const policyChildren = Array.from(policyElement.children)
  if (policyChildren.length === 0) {
    return { ...baseGuideline, shape: 'text', text: proseOf(policyElement) }
  }
  const actionElement = firstChildByTag(policyElement, 'ACTION')
  const actionChildren = actionElement ? Array.from(actionElement.children) : []
  const actionIsStepListOrAbsent = !actionElement || actionChildren.every((childElement) => ACTION_STEP_TAGS.has(childElement.tagName) && childElement.children.length === 0)
  const distinctTagNames = new Set(policyChildren.map((childElement) => childElement.tagName))
  const isStructured = actionIsStepListOrAbsent && distinctTagNames.size === policyChildren.length && policyChildren.every((childElement) => STRUCTURED_POLICY_TAGS.has(childElement.tagName))
  if (isStructured) {
    const actionIsSteps = actionChildren.length > 0
    return {
      ...baseGuideline,
      shape: 'structured',
      trigger: proseOf(firstChildByTag(policyElement, 'TRIGGER')),
      triggerKeywords: proseOf(firstChildByTag(policyElement, 'TRIGGER_KEYWORDS')),
      action: actionElement && !actionIsSteps ? proseOf(actionElement) : '',
      actionSteps: actionIsSteps ? parseActionSteps(actionElement) : [],
      requirement: proseOf(firstChildByTag(policyElement, 'REQUIREMENT')),
      format: proseOf(firstChildByTag(policyElement, 'FORMAT'))
    }
  }
  return { ...baseGuideline, shape: 'raw', rawXml: serializeChildrenXml(policyElement) }
}

function parseGuidelines(rootElement: Element): Guideline[] {
  return childElementsByTag(firstChildByTag(rootElement, 'GUIDELINES'), 'POLICY').map(parseGuideline)
}

// ---------------------------------------------------------------------
// DIALOG_CONSTRAINTS
// ---------------------------------------------------------------------
function parseDialogConstraint(constraintElement: Element): DialogConstraint {
  const type = attributeValue(constraintElement, 'type')
  const criticalElement = firstChildByTag(constraintElement, 'CRITICAL')
  if (criticalElement) {
    return {
      id: generateId('dc'),
      type,
      text: '',
      critical: textOf(criticalElement),
      action: textOf(firstChildByTag(constraintElement, 'ACTION'))
    }
  }
  return { id: generateId('dc'), type, text: textOf(constraintElement), critical: '', action: '' }
}

function parseDialogConstraints(rootElement: Element): DialogConstraint[] {
  return childElementsByTag(firstChildByTag(rootElement, 'DIALOG_CONSTRAINTS'), 'CONSTRAINT').map(parseDialogConstraint)
}

// ---------------------------------------------------------------------
// CLARIFICATION RULES — two wrapper styles seen in the wild:
//  - <CLARIFICATION_RULES_POLICY><RULE condition="...">...</RULE>...</CLARIFICATION_RULES_POLICY>
//  - <CLARIFICATION_RULES condition="..."><RULE keyword="...">...</RULE>...</CLARIFICATION_RULES>
// ---------------------------------------------------------------------
function parseClarificationRule(ruleElement: Element): ClarificationRule {
  const hasKeyword = ruleElement.getAttribute && ruleElement.getAttribute('keyword') !== null
  return {
    id: generateId('cr'),
    attrName: hasKeyword ? 'keyword' : 'condition',
    condition: hasKeyword ? attributeValue(ruleElement, 'keyword') : attributeValue(ruleElement, 'condition'),
    prompt: proseOf(firstChildByTag(ruleElement, 'PROMPT')),
    // Optional per-rule routing/handling note seen alongside PROMPT in some
    // rules (e.g. "if unsure, route to the Generic Leaks playbook").
    instruction: proseOf(firstChildByTag(ruleElement, 'INSTRUCTION')),
    comment: prose(collectPrecedingComments(ruleElement))
  }
}

function parseClarificationRules(
  rootElement: Element
): Pick<ParsedPlaybook, 'clarificationRules' | 'clarificationRulesCondition'> {
  const rulesWrapperElement = firstChildByTag(rootElement, 'CLARIFICATION_RULES') // triage-style outer wrapper
  const policyWrapperElement = firstChildByTag(rootElement, 'CLARIFICATION_RULES_POLICY') // this app's own simple wrapper
  const wrapperElement = rulesWrapperElement || policyWrapperElement
  if (!wrapperElement) {
    return { clarificationRules: [], clarificationRulesCondition: '' }
  }
  return {
    clarificationRules: childElementsByTag(wrapperElement, 'RULE').map(parseClarificationRule),
    clarificationRulesCondition: rulesWrapperElement ? attributeValue(rulesWrapperElement, 'condition') : ''
  }
}

// ---------------------------------------------------------------------
// ESCALATION_HANDLING
// ---------------------------------------------------------------------
function parseEscalation(escalationElement: Element, playbookName: string): Escalation {
  const actionElement = firstChildByTag(escalationElement, 'ACTION')
  let escalationReason = ''
  let playbookNameParam = ''
  let flowName = ''
  let note = ''
  if (actionElement) {
    const createJsonElement = firstChildByTag(actionElement, 'create_json_data_object')
    if (createJsonElement) {
      escalationReason = attributeValue(createJsonElement, 'param_escalation_reason')
      // Blank means "use the playbook's own name" (what the exporter falls
      // back to), so renaming the playbook keeps escalations in step. Only
      // a value that differs from the playbook name is stored explicitly.
      const playbookNameValue = attributeValue(createJsonElement, 'param_playbook_name')
      playbookNameParam = playbookNameValue && playbookNameValue !== playbookName ? playbookNameValue : ''
    }
    const invokeElement = firstChildByTag(actionElement, 'INVOKE_FLOW')
    if (invokeElement) {
      const nameAttributeValue = attributeValue(invokeElement, 'name')
      const flowMatch = nameAttributeValue.match(/\$\{FLOW:([^}]+)\}/)
      flowName = flowMatch ? flowMatch[1] : nameAttributeValue
      // The exporter writes escalation notes as "<!-- Note: <text> -->";
      // strip that prefix back off to recover the original `note` field.
      note = prose(collectPrecedingComments(invokeElement).replace(/^Note:\s*/, ''))
    }
  }
  // Seen with either attribute name in the wild ("condition" or "type") —
  // whichever is present is preserved via attrName so export round-trips it.
  const hasType = escalationElement.getAttribute && escalationElement.getAttribute('type') !== null
  return {
    id: generateId('esc'),
    attrName: hasType ? 'type' : 'condition',
    condition: hasType ? attributeValue(escalationElement, 'type') : attributeValue(escalationElement, 'condition'),
    // e.g. "<!-- Gas Emergency -->" sitting directly above the <ESCALATION>
    comment: prose(collectPrecedingComments(escalationElement)),
    description: proseOf(firstChildByTag(escalationElement, 'DESCRIPTION')),
    trigger: proseOf(firstChildByTag(escalationElement, 'TRIGGER')),
    escalationReason,
    playbookNameParam,
    flowName,
    note
  }
}

function parseEscalations(rootElement: Element, playbookName: string): Escalation[] {
  return childElementsByTag(firstChildByTag(rootElement, 'ESCALATION_HANDLING'), 'ESCALATION').map((escalationElement) => parseEscalation(escalationElement, playbookName))
}

// Global (playbook-level) NoMatch/NoInput reprompt logic — modeled the same
// way as a classification's <Action> (see parseClassificationAction below,
// reused directly here) so tool_type/tool_id/Parameter are genuine,
// independently editable fields rather than hardcoded boilerplate.
function parseGlobalReprompt(handlerElement: Element): GlobalReprompt {
  const actionElement = firstChildByTag(handlerElement, 'Action')
  return {
    comment: prose(collectPrecedingComments(handlerElement)),
    prompt: proseOf(firstChildByTag(handlerElement, 'PROMPT')),
    action: actionElement ? parseClassificationAction(actionElement) : { toolType: '', toolId: '', flowId: '', parameterName: '', parameterValue: '' }
  }
}

function parseGlobalReprompts(rootElement: Element): Pick<ParsedPlaybook, 'globalNoMatch' | 'globalNoInput'> {
  const eventHandlersElement = firstChildByTag(firstChildByTag(rootElement, 'ESCALATION_HANDLING'), 'EVENT_HANDLERS')
  const noMatchElement = firstChildByTag(eventHandlersElement, 'NO_MATCH')
  const noInputElement = firstChildByTag(eventHandlersElement, 'NO_INPUT')
  return {
    globalNoMatch: noMatchElement
      ? parseGlobalReprompt(noMatchElement)
      : { prompt: '', action: { toolType: '', toolId: '', flowId: '', parameterName: '', parameterValue: '' } },
    globalNoInput: noInputElement
      ? parseGlobalReprompt(noInputElement)
      : { prompt: '', action: { toolType: '', toolId: '', flowId: '', parameterName: '', parameterValue: '' } }
  }
}

// ---------------------------------------------------------------------
// ROUTING_LOGIC — a router/triage playbook's equivalent of DIAGNOSTIC_FLOWS:
// routes to other playbooks by name rather than asking its own questions.
// ---------------------------------------------------------------------
function parseRoutingCategory(categoryElement: Element): RoutingCategory {
  return {
    id: generateId('rc'),
    name: attributeValue(categoryElement, 'name'),
    comment: prose(collectPrecedingComments(categoryElement)),
    triggers: proseOf(firstChildByTag(categoryElement, 'TRIGGERS')),
    action: proseOf(firstChildByTag(categoryElement, 'ACTION'))
  }
}

function parseRoutingLogic(rootElement: Element): RoutingCategory[] {
  return childElementsByTag(firstChildByTag(rootElement, 'ROUTING_LOGIC'), 'CATEGORY').map(parseRoutingCategory)
}

// ---------------------------------------------------------------------
// DIAGNOSTIC_FLOWS
// ---------------------------------------------------------------------
function parseClassificationAction(actionElement: Element): Action {
  const toolType = attributeValue(actionElement, 'tool_type')
  const toolId = attributeValue(actionElement, 'tool_id')
  const flowId = attributeValue(actionElement, 'flow_id')
  let parameterName = attributeValue(actionElement, 'parameter_name')
  let parameterValue = attributeValue(actionElement, 'value')
  const parameterElement = firstChildByTag(actionElement, 'Parameter')
  if (parameterElement) {
    parameterName = attributeValue(parameterElement, 'name')
    parameterValue = textOf(parameterElement)
  }
  return { id: generateId('a'), toolType, toolId, flowId, parameterName, parameterValue }
}

function parseClassification(classificationElement: Element): Classification {
  const comment = collectPrecedingComments(classificationElement)
  let query = ''
  const actions: Action[] = []
  Array.from(classificationElement.children).forEach((childElement) => {
    if (childElement.tagName === 'Parameter' && attributeValue(childElement, 'name') === 'query') {
      query = textOf(childElement)
    } else if (childElement.tagName === 'Action') {
      actions.push(parseClassificationAction(childElement))
    }
  })
  return {
    id: generateId('c'),
    classificationId: attributeValue(classificationElement, 'ID'),
    nextStep: attributeValue(classificationElement, 'next_step'),
    triggerCondition: textOf(firstChildByTag(classificationElement, 'TriggerCondition')),
    query,
    dialogResponse: textOf(firstChildByTag(classificationElement, 'DialogResponse')),
    comment,
    actions
  }
}

function parseEventHandlers(agentInteractionElement: Element | null): Pick<Step, 'noMatchResponse' | 'noInputResponse'> {
  const eventHandlersElement = firstChildByTag(agentInteractionElement, 'EventHandlers')
  return {
    noMatchResponse: textOf(firstChildByTag(firstChildByTag(eventHandlersElement, 'NoMatch'), 'DialogResponse')),
    noInputResponse: textOf(firstChildByTag(firstChildByTag(eventHandlersElement, 'NoInput'), 'DialogResponse'))
  }
}

function parseDialogStep(stepElement: Element): Step {
  const comment = collectPrecedingComments(stepElement)
  const agentInteractionElement = firstChildByTag(stepElement, 'AgentInteraction')
  const promptElement = firstChildByTag(agentInteractionElement, 'Prompt')
  // Normally a sibling of AgentInteraction, but tolerate it being nested
  // inside AgentInteraction too (seen in hand-edited source documents).
  const instructionsElement =
    firstChildByTag(stepElement, 'DialogStepSpecificInstructions') || firstChildByTag(agentInteractionElement, 'DialogStepSpecificInstructions')
  const { noMatchResponse, noInputResponse } = parseEventHandlers(agentInteractionElement)
  return {
    id: attributeValue(stepElement, 'ID'),
    topic: attributeValue(stepElement, 'topic'),
    issueSummary: textOf(firstChildByTag(stepElement, 'IssueSummary')),
    instructions: instructionsElement ? textOf(instructionsElement) : '',
    comment,
    promptType: attributeValue(promptElement, 'type') || 'InitialQuery',
    promptComment: promptElement ? collectPrecedingComments(promptElement) : '',
    prompt: textOf(promptElement),
    noMatchResponse,
    noInputResponse,
    classifications: childElementsByTag(firstChildByTag(stepElement, 'ExpectedClassifications'), 'Classification').map(parseClassification)
  }
}

function parseSteps(flowsRoot: Element | null): Step[] {
  return childElementsByTag(flowsRoot, 'DIALOG_STEP').map(parseDialogStep)
}

/**
 * Parses one playbook XML document into the app's internal playbook shape.
 * Accepts either a full <LLM_INSTRUCTIONS> document (playbook config +
 * steps) or a bare <DIAGNOSTIC_FLOWS> document (steps only — the config
 * fields come back blank). Every nested record (steps, classifications,
 * actions, guidelines, ...) is already assigned a fresh unique `id`.
 */
export function parsePlaybookXml(xmlText: string): ParsedPlaybook {
  const xmlDocument = new DOMParser().parseFromString(xmlText, 'application/xml')
  const parserError = xmlDocument.querySelector('parsererror')
  if (parserError) {
    throw new Error(`Not valid XML: ${parserError.textContent.trim().slice(0, 200)}`)
  }
  const rootElement = xmlDocument.documentElement
  if (!rootElement || (rootElement.tagName !== 'LLM_INSTRUCTIONS' && rootElement.tagName !== 'DIAGNOSTIC_FLOWS')) {
    throw new Error('Expected a root <LLM_INSTRUCTIONS> (or bare <DIAGNOSTIC_FLOWS>) element.')
  }

  const includeXmlDeclaration = /^\s*(\uFEFF)?\s*<\?xml/.test(xmlText)

  if (rootElement.tagName === 'DIAGNOSTIC_FLOWS') {
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
      steps: parseSteps(rootElement)
    }
  }

  const { playbookName, setup } = parseSetup(rootElement)
  const { clarificationRules, clarificationRulesCondition } = parseClarificationRules(rootElement)
  const { globalNoMatch, globalNoInput } = parseGlobalReprompts(rootElement)
  const { sectionOrder, sectionComments } = parseDocumentLayout(rootElement)
  return {
    playbookName,
    includeXmlDeclaration,
    sectionOrder,
    sectionComments,
    setup,
    guidelines: parseGuidelines(rootElement),
    dialogConstraints: parseDialogConstraints(rootElement),
    clarificationRules,
    clarificationRulesCondition,
    escalations: parseEscalations(rootElement, playbookName),
    globalNoMatch,
    globalNoInput,
    routingCategories: parseRoutingLogic(rootElement),
    steps: parseSteps(firstChildByTag(rootElement, 'DIAGNOSTIC_FLOWS'))
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
 * @returns guideline fields (no id / policyId)
 */
export function structurePolicyBody(rawXml: string): Partial<Guideline> | null {
  try {
    const xmlDocument = new DOMParser().parseFromString(`<POLICY>${rawXml || ''}</POLICY>`, 'application/xml')
    if (xmlDocument.querySelector('parsererror')) return null
    const parsedGuideline = parseGuideline(xmlDocument.documentElement)
    if (parsedGuideline.shape !== 'structured') return null
    // Keep every field except the ones that identify/annotate the policy itself.
    const guidelineFields = { ...parsedGuideline }
    delete guidelineFields.id
    delete guidelineFields.policyId
    delete guidelineFields.comment
    return { ...guidelineFields, rawXml: '' }
  } catch {
    return null
  }
}
