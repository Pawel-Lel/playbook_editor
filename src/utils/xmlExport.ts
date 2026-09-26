// Serializes the live stores (playbook config + steps) back into the full
// <LLM_INSTRUCTIONS> XML schema: SETUP, GUIDELINES, DIALOG_CONSTRAINTS,
// CLARIFICATION_RULES_POLICY, ESCALATION_HANDLING and DIAGNOSTIC_FLOWS. The
// inverse of utils/xmlImport.js; the record shape is store/playbooks.js's
// normalizeRecord().

import type {
  Action,
  ActionStep,
  ClarificationRule,
  Classification,
  GlobalReprompt,
  Guideline,
  PlaybookSettings,
  PolicyShape,
  SectionKey,
  Step
} from '../types'

// How this file works: every build...() function returns an array of
// output lines (`xmlLines`), each already indented; the caller appends them
// to its own array with `xmlLines.push(...buildX())` (the `...` spreads one
// array's items into another), and buildLlmInstructionsXml() finally joins
// all lines with newlines. Plain JavaScript — no Vue in this file.

// One indentation step (4 spaces); indent(2) = 8 spaces, and so on.
const INDENT_UNIT = '    '
const indent = (level: number): string => INDENT_UNIT.repeat(level)

// Makes text safe to put between XML tags: & < > become &amp; &lt; &gt;
function escapeXmlText(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Same, plus " → &quot; so the value can sit inside attribute="..."
function escapeXmlAttribute(value: unknown): string {
  return escapeXmlText(value).replace(/"/g, '&quot;')
}

// Wraps long text at ~90 chars per line, re-indented, to mirror the
// hand-wrapped prose formatting used in the source document. Preserves
// existing line breaks (e.g. "- bullet\n- bullet" instruction blocks).
function wrapText(text: string | null | undefined, indentLevel: number): string {
  const trimmedText = String(text ?? '').trim()
  if (!trimmedText) return ''
  return trimmedText
    .split('\n')
    .map((paragraph) => {
      const words = paragraph.trim().split(/\s+/).filter(Boolean)
      if (!words.length) return ''
      const wrappedLines: string[] = []
      let currentLine = ''
      words.forEach((word) => {
        if ((currentLine + ' ' + word).trim().length > 90) {
          wrappedLines.push(currentLine.trim())
          currentLine = word
        } else {
          currentLine = (currentLine + ' ' + word).trim()
        }
      })
      if (currentLine) wrappedLines.push(currentLine.trim())
      return wrappedLines.map((wrappedLine) => indent(indentLevel) + escapeXmlText(wrappedLine)).join('\n')
    })
    .filter(Boolean)
    .join('\n')
}

// Splits a `comment` field into paragraphs (blank-line separated) and
// renders each as its own <!-- ... --> block, wrapped to ~86 chars and
// re-indented — mirrors how the source document stacks multiple XML
// comments immediately above one element (e.g. a big section note followed
// by a short scenario label). "--" is escaped since XML comments can't
// contain it.
function buildCommentBlock(text: string | null | undefined, indentLevel: number): string[] {
  const trimmedText = String(text || '').trim()
  if (!trimmedText) return []
  const xmlLines: string[] = []
  const paragraphs = trimmedText.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean)
  paragraphs.forEach((paragraph) => {
    const safeParagraph = paragraph.replace(/--/g, '\u2013\u2013')
    const sourceLines = safeParagraph.split('\n')
    const wrappedLines: string[] = []
    sourceLines.forEach((sourceLine) => {
      const words = sourceLine.trim().split(/\s+/).filter(Boolean)
      if (!words.length) {
        wrappedLines.push('')
        return
      }
      let currentLine = ''
      words.forEach((word) => {
        if ((currentLine + ' ' + word).trim().length > 86) {
          wrappedLines.push(currentLine.trim())
          currentLine = word
        } else {
          currentLine = (currentLine + ' ' + word).trim()
        }
      })
      if (currentLine) wrappedLines.push(currentLine.trim())
    })
    if (wrappedLines.length === 1) {
      xmlLines.push(indent(indentLevel) + `<!-- ${wrappedLines[0]} -->`)
    } else {
      xmlLines.push(indent(indentLevel) + `<!-- ${wrappedLines[0]}`)
      for (let lineIndex = 1; lineIndex < wrappedLines.length - 1; lineIndex++) {
        xmlLines.push(wrappedLines[lineIndex] === '' ? '' : indent(indentLevel) + wrappedLines[lineIndex])
      }
      xmlLines.push(indent(indentLevel) + `${wrappedLines[wrappedLines.length - 1]} -->`)
    }
  })
  return xmlLines
}

// XML comments can't contain "--"; everything else is emitted verbatim
// (comments aren't entity-decoded, so "&" must NOT be escaped here).
function commentSafe(text: string | null | undefined): string {
  return String(text ?? '').replace(/--/g, '\u2013\u2013')
}

// ---------------------------------------------------------------------
// DOCUMENT LAYOUT — which top-level sections are written, in what order,
// and the <!-- ... --> comment above each. A playbook imported from XML
// remembers both (sectionOrder / sectionComments), so e.g. Triage.xml's
// "ESCALATION_HANDLING before CLARIFICATION_RULES" order and its
// "<!-- STEP 1: CLARIFY AMBIGUOUS INPUTS -->" headings survive a round trip.
// ---------------------------------------------------------------------
export const SECTION_KEYS: SectionKey[] = [
  'SETUP',
  'GUIDELINES',
  'DIALOG_CONSTRAINTS',
  'CLARIFICATION_RULES',
  'ESCALATION_HANDLING',
  'ROUTING_LOGIC',
  'DIAGNOSTIC_FLOWS'
]

export const SECTION_LABELS: Record<SectionKey, string> = {
  SETUP: 'Setup',
  GUIDELINES: 'Guidelines',
  DIALOG_CONSTRAINTS: 'Dialog constraints',
  CLARIFICATION_RULES: 'Clarification rules',
  ESCALATION_HANDLING: 'Escalation handling',
  ROUTING_LOGIC: 'Routing logic',
  DIAGNOSTIC_FLOWS: 'Diagnostic flows (dialog steps)'
}

export const DEFAULT_SECTION_COMMENTS: Record<SectionKey, string> = {
  SETUP: 'SETUP AND INITIALIZATION',
  GUIDELINES: 'CUSTOMER INTERACTION GUIDELINES',
  DIALOG_CONSTRAINTS: 'QUESTIONING CONSTRAINTS',
  CLARIFICATION_RULES: 'CLARIFICATION PROMPTS',
  ESCALATION_HANDLING: 'ESCALATION HANDLING',
  ROUTING_LOGIC: 'CATEGORIZATION & ROUTING',
  DIAGNOSTIC_FLOWS: ''
}

// A stored comment (even an empty string) wins; only a missing key falls
// back to the default, so a user can deliberately blank a section comment.
function sectionComment(playbook: PlaybookSettings, sectionKey: SectionKey): string {
  const storedComment = playbook.sectionComments?.[sectionKey]
  return storedComment === undefined || storedComment === null ? DEFAULT_SECTION_COMMENTS[sectionKey] : storedComment
}

function sectionCommentLines(playbook: PlaybookSettings, sectionKey: SectionKey, indentLevel = 1): string[] {
  const commentText = sectionComment(playbook, sectionKey)
  return commentText?.trim() ? [indent(indentLevel) + `<!-- ${commentSafe(commentText.trim())} -->`] : []
}

function sectionHasContent(playbook: PlaybookSettings, steps: Step[], sectionKey: SectionKey): boolean {
  switch (sectionKey) {
    case 'SETUP':
    case 'ESCALATION_HANDLING':
      return true
    case 'GUIDELINES':
      return (playbook.guidelines || []).length > 0
    case 'DIALOG_CONSTRAINTS':
      return (playbook.dialogConstraints || []).length > 0
    case 'CLARIFICATION_RULES':
      return (playbook.clarificationRules || []).length > 0 || !!playbook.clarificationRulesCondition?.trim()
    case 'ROUTING_LOGIC':
      return (playbook.routingCategories || []).length > 0
    case 'DIAGNOSTIC_FLOWS':
      return (steps || []).length > 0
    default:
      return false
  }
}

/**
 * The sections that will actually be written, in order: the playbook's own
 * stored sectionOrder first (sections it lists are always written, even if
 * currently empty — the source had them), then any other section that has
 * content, at its default position. Without a stored order (older saved
 * data, new playbooks) only sections with content are written.
 */
export function resolveSectionOrder(playbook: PlaybookSettings, steps: Step[]): SectionKey[] {
  const storedOrder = Array.isArray(playbook.sectionOrder) ? playbook.sectionOrder : []
  const sectionOrder: SectionKey[] = []
  storedOrder.forEach((sectionKey) => {
    if (SECTION_KEYS.includes(sectionKey) && !sectionOrder.includes(sectionKey)) sectionOrder.push(sectionKey)
  })
  if (!sectionOrder.length) {
    SECTION_KEYS.forEach((sectionKey) => {
      if (sectionKey === 'GUIDELINES' || sectionHasContent(playbook, steps, sectionKey)) sectionOrder.push(sectionKey)
    })
    return sectionOrder
  }
  SECTION_KEYS.forEach((sectionKey, defaultIndex) => {
    if (sectionOrder.includes(sectionKey) || !sectionHasContent(playbook, steps, sectionKey)) return
    // insert after the last already-placed section that precedes k by default
    let insertIndex = 0
    sectionOrder.forEach((placedKey, placedIndex) => {
      if (SECTION_KEYS.indexOf(placedKey) < defaultIndex) insertIndex = placedIndex + 1
    })
    sectionOrder.splice(insertIndex, 0, sectionKey)
  })
  return sectionOrder
}

// ---------------------------------------------------------------------
// SETUP — CONTEXT_HANDLING and ROLE/OBJECTIVE are two different styles;
// each is only emitted if its fields are actually populated, so either (or
// in principle both) can appear depending on which the playbook uses.
// ---------------------------------------------------------------------
function buildSetup(playbook: PlaybookSettings): string[] {
  const xmlLines: string[] = []
  xmlLines.push(...sectionCommentLines(playbook, 'SETUP'))
  xmlLines.push(indent(1) + '<SETUP>')
  xmlLines.push(indent(2) + `<PARAMETER_ASSIGNMENT name="param_playbook_name" value="${escapeXmlAttribute(playbook.playbookName)}" />`)
  if (playbook.setup?.role?.trim()) {
    xmlLines.push(indent(2) + `<ROLE>${escapeXmlText(playbook.setup.role)}</ROLE>`)
  }
  if (playbook.setup?.objective?.trim()) {
    xmlLines.push(indent(2) + '<OBJECTIVE>')
    xmlLines.push(wrapText(playbook.setup.objective, 3))
    xmlLines.push(indent(2) + '</OBJECTIVE>')
  }
  if (playbook.setup?.contextInstruction?.trim() || playbook.setup?.contextConstraint?.trim()) {
    xmlLines.push(indent(2) + '<CONTEXT_HANDLING>')
    xmlLines.push(indent(3) + `<INSTRUCTION>${escapeXmlText(playbook.setup?.contextInstruction)}</INSTRUCTION>`)
    xmlLines.push(indent(3) + '<CONSTRAINT>')
    xmlLines.push(wrapText(playbook.setup?.contextConstraint, 4))
    xmlLines.push(indent(3) + '</CONSTRAINT>')
    xmlLines.push(indent(2) + '</CONTEXT_HANDLING>')
  }
  xmlLines.push(indent(1) + '</SETUP>')
  return xmlLines
}

// ---------------------------------------------------------------------
// GUIDELINES (POLICY entries) — three shapes (see xmlImport.js's
// parseGuideline): 'text' one-liner, 'structured' (TRIGGER /
// TRIGGER_KEYWORDS / ACTION[text or SET_PARAMETER/INVOKE_FLOW steps] /
// REQUIREMENT / FORMAT), or 'raw' (rawXml emitted verbatim). Records saved
// before `shape` existed have it inferred from which fields are filled.
// ---------------------------------------------------------------------
export function inferPolicyShape(guideline: Partial<Guideline>): PolicyShape {
  if (guideline.shape === 'text' || guideline.shape === 'structured' || guideline.shape === 'raw') return guideline.shape
  if (guideline.rawXml?.trim()) return 'raw'
  if (
    guideline.trigger?.trim() ||
    guideline.action?.trim() ||
    guideline.triggerKeywords?.trim() ||
    guideline.requirement?.trim() ||
    guideline.format?.trim() ||
    (guideline.actionSteps || []).length
  ) {
    return 'structured'
  }
  return 'text'
}

function flowRef(flowName: string): string {
  const trimmedName = String(flowName || '').trim()
  return trimmedName.startsWith('${') ? trimmedName : `\${FLOW:${trimmedName}}`
}

function buildActionStep(actionStep: ActionStep, indentLevel: number): string {
  if (actionStep.kind === 'INVOKE_FLOW') {
    return indent(indentLevel) + `<INVOKE_FLOW name="${escapeXmlAttribute(flowRef(actionStep.name))}" />`
  }
  const attributes: string[] = [`name="${escapeXmlAttribute(actionStep.name)}"`]
  if (actionStep.value !== undefined && actionStep.value !== '') attributes.push(`value="${escapeXmlAttribute(actionStep.value)}"`)
  return indent(indentLevel) + `<${actionStep.kind || 'SET_PARAMETER'} ${attributes.join(' ')} />`
}

function buildGuidelinePolicy(guideline: Guideline): string[] {
  const xmlLines: string[] = []
  xmlLines.push(...buildCommentBlock(guideline.comment, 2))
  const policyShape = inferPolicyShape(guideline)
  const policyOpenTag = indent(2) + `<POLICY id="${escapeXmlAttribute(guideline.policyId)}">`
  if (policyShape === 'raw') {
    xmlLines.push(policyOpenTag)
    String(guideline.rawXml || '').split('\n').forEach((rawLine) => {
      xmlLines.push(rawLine.trim() === '' ? '' : indent(3) + rawLine)
    })
    xmlLines.push(indent(2) + '</POLICY>')
    return xmlLines
  }
  if (policyShape === 'structured') {
    xmlLines.push(policyOpenTag)
    if (guideline.trigger?.trim()) xmlLines.push(indent(3) + `<TRIGGER>${escapeXmlText(guideline.trigger)}</TRIGGER>`)
    if (guideline.triggerKeywords?.trim()) xmlLines.push(indent(3) + `<TRIGGER_KEYWORDS>${escapeXmlText(guideline.triggerKeywords)}</TRIGGER_KEYWORDS>`)
    const namedActionSteps = (guideline.actionSteps || []).filter((actionStep) => String(actionStep.name || '').trim())
    if (namedActionSteps.length) {
      xmlLines.push(indent(3) + '<ACTION>')
      namedActionSteps.forEach((actionStep) => xmlLines.push(buildActionStep(actionStep, 4)))
      xmlLines.push(indent(3) + '</ACTION>')
    } else if (guideline.action?.trim()) {
      xmlLines.push(indent(3) + `<ACTION>${escapeXmlText(guideline.action)}</ACTION>`)
    }
    if (guideline.requirement?.trim()) xmlLines.push(indent(3) + `<REQUIREMENT>${escapeXmlText(guideline.requirement)}</REQUIREMENT>`)
    if (guideline.format?.trim()) xmlLines.push(indent(3) + `<FORMAT>${escapeXmlText(guideline.format)}</FORMAT>`)
    xmlLines.push(indent(2) + '</POLICY>')
    return xmlLines
  }
  xmlLines.push(indent(2) + `<POLICY id="${escapeXmlAttribute(guideline.policyId)}">${escapeXmlText(guideline.text)}</POLICY>`)
  return xmlLines
}

function buildGuidelines(playbook: PlaybookSettings): string[] {
  const xmlLines: string[] = []
  xmlLines.push(...sectionCommentLines(playbook, 'GUIDELINES'))
  xmlLines.push(indent(1) + '<GUIDELINES>')
  ;(playbook.guidelines || []).forEach((guideline) => xmlLines.push(...buildGuidelinePolicy(guideline)))
  xmlLines.push(indent(1) + '</GUIDELINES>')
  return xmlLines
}

// ---------------------------------------------------------------------
// DIALOG_CONSTRAINTS
// ---------------------------------------------------------------------
function buildDialogConstraints(playbook: PlaybookSettings): string[] {
  const xmlLines: string[] = []
  xmlLines.push(...sectionCommentLines(playbook, 'DIALOG_CONSTRAINTS'))
  xmlLines.push(indent(1) + '<DIALOG_CONSTRAINTS>')
  ;(playbook.dialogConstraints || []).forEach((constraint) => {
    xmlLines.push(indent(2) + `<CONSTRAINT type="${escapeXmlAttribute(constraint.type)}">`)
    if (constraint.critical?.trim()) {
      xmlLines.push(indent(3) + `<CRITICAL>${escapeXmlText(constraint.critical)}</CRITICAL>`)
      if (constraint.action?.trim()) xmlLines.push(indent(3) + `<ACTION>${escapeXmlText(constraint.action)}</ACTION>`)
    } else {
      xmlLines.push(wrapText(constraint.text, 3))
    }
    xmlLines.push(indent(2) + '</CONSTRAINT>')
  })
  xmlLines.push(indent(1) + '</DIALOG_CONSTRAINTS>')
  return xmlLines
}

// ---------------------------------------------------------------------
// CLARIFICATION RULES — the plain <CLARIFICATION_RULES_POLICY> wrapper by
// default; if the playbook has its own shared condition, it's wrapped in
// <CLARIFICATION_RULES condition="..."> instead, matching the
// router/triage-style schema. Each RULE's own attribute name (condition vs
// keyword) is preserved per-item.
// ---------------------------------------------------------------------
function buildClarificationRuleElement(rule: ClarificationRule): string[] {
  const xmlLines: string[] = []
  const attributeName = rule.attrName === 'keyword' ? 'keyword' : 'condition'
  xmlLines.push(...buildCommentBlock(rule.comment, 2))
  xmlLines.push(indent(2) + `<RULE ${attributeName}="${escapeXmlAttribute(rule.condition)}">`)
  xmlLines.push(indent(3) + `<PROMPT>${escapeXmlText(rule.prompt)}</PROMPT>`)
  if (rule.instruction?.trim()) {
    xmlLines.push(indent(3) + '<INSTRUCTION>')
    xmlLines.push(wrapText(rule.instruction, 4))
    xmlLines.push(indent(3) + '</INSTRUCTION>')
  }
  xmlLines.push(indent(2) + '</RULE>')
  return xmlLines
}

function buildClarificationRules(playbook: PlaybookSettings): string[] {
  const xmlLines: string[] = []
  xmlLines.push(...sectionCommentLines(playbook, 'CLARIFICATION_RULES'))
  if (playbook.clarificationRulesCondition?.trim()) {
    xmlLines.push(indent(1) + `<CLARIFICATION_RULES condition="${escapeXmlAttribute(playbook.clarificationRulesCondition)}">`)
    ;(playbook.clarificationRules || []).forEach((rule) => xmlLines.push(...buildClarificationRuleElement(rule)))
    xmlLines.push(indent(1) + '</CLARIFICATION_RULES>')
  } else {
    xmlLines.push(indent(1) + '<CLARIFICATION_RULES_POLICY>')
    ;(playbook.clarificationRules || []).forEach((rule) => xmlLines.push(...buildClarificationRuleElement(rule)))
    xmlLines.push(indent(1) + '</CLARIFICATION_RULES_POLICY>')
  }
  return xmlLines
}

// ---------------------------------------------------------------------
// ESCALATION_HANDLING
// ---------------------------------------------------------------------
// Global (playbook-level) NoMatch/NoInput reprompts — modeled the same way
// as a classification's <Action> (see buildActionElement below, reused
// directly here), so tool_type/tool_id/Parameter are genuine, independently
// editable fields rather than hardcoded boilerplate.
function buildRepromptBlock(tagName: string, defaultComment: string, reprompt: GlobalReprompt, indentLevel: number): string[] {
  const xmlLines: string[] = []
  const commentText = reprompt.comment === undefined || reprompt.comment === null ? defaultComment : reprompt.comment
  xmlLines.push(...buildCommentBlock(commentText, indentLevel))
  xmlLines.push(indent(indentLevel) + `<${tagName}>`)
  xmlLines.push(indent(indentLevel + 1) + '<PROMPT>')
  xmlLines.push(wrapText(reprompt.prompt, indentLevel + 2))
  xmlLines.push(indent(indentLevel + 1) + '</PROMPT>')
  xmlLines.push(...buildActionElement(reprompt.action || {}, indentLevel + 1))
  xmlLines.push(indent(indentLevel) + `</${tagName}>`)
  return xmlLines
}

function buildGlobalEventHandlers(playbook: PlaybookSettings): string[] {
  // `|| {}` covers older saved data without these fields; `as` tells
  // TypeScript to treat that empty object as a (blank) reprompt.
  const noMatch = playbook.globalNoMatch || ({} as GlobalReprompt)
  const noInput = playbook.globalNoInput || ({} as GlobalReprompt)
  const hasNoMatch = noMatch.prompt?.trim()
  const hasNoInput = noInput.prompt?.trim()
  if (!hasNoMatch && !hasNoInput) return []
  const xmlLines: string[] = []
  xmlLines.push(indent(2) + '<EVENT_HANDLERS>')
  if (hasNoMatch) {
    xmlLines.push(...buildRepromptBlock('NO_MATCH', "Reprompt for when the user's input is not understood (No Match)", noMatch, 3))
  }
  if (hasNoInput) {
    xmlLines.push(...buildRepromptBlock('NO_INPUT', 'Reprompt for when the user provides no input (No Input)', noInput, 3))
  }
  xmlLines.push(indent(2) + '</EVENT_HANDLERS>')
  return xmlLines
}

function buildEscalationHandling(playbook: PlaybookSettings): string[] {
  const xmlLines: string[] = []
  xmlLines.push(...sectionCommentLines(playbook, 'ESCALATION_HANDLING'))
  xmlLines.push(indent(1) + '<ESCALATION_HANDLING>')
  ;(playbook.escalations || []).forEach((escalation) => {
    const attributeName = escalation.attrName === 'type' ? 'type' : 'condition'
    xmlLines.push(...buildCommentBlock(escalation.comment, 2))
    xmlLines.push(indent(2) + `<ESCALATION ${attributeName}="${escapeXmlAttribute(escalation.condition)}">`)
    if (escalation.description?.trim()) {
      xmlLines.push(indent(3) + '<DESCRIPTION>')
      xmlLines.push(wrapText(escalation.description, 4))
      xmlLines.push(indent(3) + '</DESCRIPTION>')
    }
    if (escalation.trigger?.trim()) {
      xmlLines.push(indent(3) + `<TRIGGER>${escapeXmlText(escalation.trigger)}</TRIGGER>`)
    }
    xmlLines.push(indent(3) + '<ACTION>')
    xmlLines.push(
      indent(4) +
        `<create_json_data_object param_escalation_reason="${escapeXmlAttribute(escalation.escalationReason)}" param_playbook_name="${escapeXmlAttribute(
          escalation.playbookNameParam?.trim() || playbook.playbookName
        )}" />`
    )
    if (escalation.note?.trim()) {
      xmlLines.push(...buildCommentBlock(`Note: ${escalation.note.trim()}`, 4))
    }
    xmlLines.push(indent(4) + `<INVOKE_FLOW name="\${FLOW:${escapeXmlText(escalation.flowName)}}" />`)
    xmlLines.push(indent(3) + '</ACTION>')
    xmlLines.push(indent(2) + '</ESCALATION>')
  })
  xmlLines.push(...buildGlobalEventHandlers(playbook))
  xmlLines.push(indent(1) + '</ESCALATION_HANDLING>')
  return xmlLines
}

// ---------------------------------------------------------------------
// ROUTING_LOGIC — a router/triage playbook's equivalent of DIAGNOSTIC_FLOWS,
// only emitted when the playbook actually has routing categories.
// ---------------------------------------------------------------------
function buildRoutingLogic(playbook: PlaybookSettings): string[] {
  const categories = playbook.routingCategories || []
  if (!categories.length) return []
  const xmlLines: string[] = []
  xmlLines.push(...sectionCommentLines(playbook, 'ROUTING_LOGIC'))
  xmlLines.push(indent(1) + '<ROUTING_LOGIC>')
  categories.forEach((category) => {
    xmlLines.push(...buildCommentBlock(category.comment, 2))
    xmlLines.push(indent(2) + `<CATEGORY name="${escapeXmlAttribute(category.name)}">`)
    xmlLines.push(indent(3) + '<TRIGGERS>')
    xmlLines.push(wrapText(category.triggers, 4))
    xmlLines.push(indent(3) + '</TRIGGERS>')
    xmlLines.push(indent(3) + `<ACTION>${escapeXmlText(category.action)}</ACTION>`)
    xmlLines.push(indent(2) + '</CATEGORY>')
  })
  xmlLines.push(indent(1) + '</ROUTING_LOGIC>')
  return xmlLines
}

// ---------------------------------------------------------------------
// DIAGNOSTIC_FLOWS
// ---------------------------------------------------------------------
function buildEventHandlingBlock(): string[] {
  const xmlLines: string[] = []
  xmlLines.push(indent(2) + '<EVENT_HANDLING>')
  xmlLines.push(indent(3) + '<RULE scope="all_dialog_steps" priority="high">')
  xmlLines.push(indent(4) + '<TRIGGER>NoInput OR NoMatch event fires in any DIALOG_STEP</TRIGGER>')
  xmlLines.push(indent(4) + '<MANDATORY_ACTION>')
  xmlLines.push(indent(5) + '<DESCRIPTION>')
  xmlLines.push(
    wrapText(
      'Invoke external_memory_redis immediately when a NoInput or NoMatch event is detected, ' +
        'passing the current session ID and any issue context gathered so far. This must occur ' +
        'BEFORE the reprompt dialog response is delivered to the customer.',
      6
    )
  )
  xmlLines.push(indent(5) + '</DESCRIPTION>')
  xmlLines.push(indent(4) + '</MANDATORY_ACTION>')
  xmlLines.push(indent(3) + '</RULE>')
  xmlLines.push(indent(2) + '</EVENT_HANDLING>')
  return xmlLines
}

function buildRepromptAction(indentLevel: number): string[] {
  const xmlLines: string[] = []
  xmlLines.push(indent(indentLevel) + '<Action tool_type="Tool_Invocation" tool_id="external_memory_redis">')
  xmlLines.push(
    indent(indentLevel + 1) +
      '<Parameter name="session_id">state["$session_id"]</Parameter> Invoke ${TOOL:external_memory_redis}'
  )
  xmlLines.push(indent(indentLevel) + '</Action>')
  return xmlLines
}

function buildEventHandlers(step: Step): string[] {
  const hasNoMatch = !!step.noMatchResponse?.trim()
  const hasNoInput = !!step.noInputResponse?.trim()
  if (!hasNoMatch && !hasNoInput) return []

  const xmlLines: string[] = []
  xmlLines.push(indent(4) + '<EventHandlers>')
  if (hasNoMatch) {
    xmlLines.push(indent(5) + '<!-- Reprompt for when the user\'s input is not understood (No Match) -->')
    xmlLines.push(indent(5) + '<NoMatch>')
    xmlLines.push(indent(6) + `<DialogResponse>${escapeXmlText(step.noMatchResponse)}</DialogResponse>`)
    xmlLines.push(...buildRepromptAction(6))
    xmlLines.push(indent(5) + '</NoMatch>')
  }
  if (hasNoInput) {
    xmlLines.push(indent(5) + '<!-- Reprompt for when the user provides no input (No Input) -->')
    xmlLines.push(indent(5) + '<NoInput>')
    xmlLines.push(indent(6) + `<DialogResponse>${escapeXmlText(step.noInputResponse)}</DialogResponse>`)
    xmlLines.push(...buildRepromptAction(6))
    xmlLines.push(indent(5) + '</NoInput>')
  }
  xmlLines.push(indent(4) + '</EventHandlers>')
  return xmlLines
}

function buildActionElement(action: Partial<Action>, indentLevel: number): string[] {
  const xmlLines: string[] = []
  const attributes: string[] = []
  if (action.toolType) attributes.push(`tool_type="${escapeXmlAttribute(action.toolType)}"`)
  if (action.toolId) attributes.push(`tool_id="${escapeXmlAttribute(action.toolId)}"`)
  if (action.flowId) attributes.push(`flow_id="${escapeXmlAttribute(action.flowId)}"`)

  // Internal_State_Update in the source is self-closing with the parameter
  // baked in as attributes rather than a nested <Parameter> element.
  if (action.toolType === 'Internal_State_Update') {
    if (action.parameterName) attributes.push(`parameter_name="${escapeXmlAttribute(action.parameterName)}"`)
    if (action.parameterValue) attributes.push(`value="${escapeXmlAttribute(action.parameterValue)}"`)
    xmlLines.push(indent(indentLevel) + `<Action ${attributes.join(' ')} />`)
    return xmlLines
  }

  xmlLines.push(indent(indentLevel) + `<Action ${attributes.join(' ')}>`)
  if (action.parameterName) {
    xmlLines.push(indent(indentLevel + 1) + `<Parameter name="${escapeXmlAttribute(action.parameterName)}">${escapeXmlText(action.parameterValue)}</Parameter>`)
  }
  if (action.toolType === 'Flow_Invocation' && action.flowId) {
    xmlLines.push(indent(indentLevel + 1) + `\${FLOW:${escapeXmlText(action.flowId)}}`)
  } else if (action.toolType === 'RAG_Retrieval' && action.toolId) {
    xmlLines.push(indent(indentLevel + 1) + `\${TOOL:${escapeXmlText(action.toolId)}}`)
  } else if (action.toolType === 'Tool_Invocation' && action.toolId) {
    xmlLines.push(indent(indentLevel + 1) + `Invoke \${TOOL:${escapeXmlText(action.toolId)}}`)
  }
  xmlLines.push(indent(indentLevel) + '</Action>')
  return xmlLines
}

function buildClassification(classification: Classification): string[] {
  const xmlLines: string[] = []
  xmlLines.push(...buildCommentBlock(classification.comment, 4))
  const attributes: string[] = [`ID="${escapeXmlAttribute(classification.classificationId)}"`]
  if (classification.nextStep?.trim()) attributes.push(`next_step="${escapeXmlAttribute(classification.nextStep)}"`)
  xmlLines.push(indent(4) + `<Classification ${attributes.join(' ')}>`)
  if (classification.triggerCondition?.trim()) {
    xmlLines.push(indent(5) + `<TriggerCondition>${escapeXmlText(classification.triggerCondition)}</TriggerCondition>`)
  }
  if (classification.query?.trim()) {
    xmlLines.push(indent(5) + `<Parameter name="query">${escapeXmlText(classification.query)}</Parameter>`)
  }
  if (classification.dialogResponse?.trim()) {
    xmlLines.push(indent(5) + `<DialogResponse>${escapeXmlText(classification.dialogResponse)}</DialogResponse>`)
  }
  ;(classification.actions || []).forEach((action) => xmlLines.push(...buildActionElement(action, 5)))
  xmlLines.push(indent(4) + '</Classification>')
  return xmlLines
}

function buildDialogStep(step: Step): string[] {
  const xmlLines: string[] = []
  xmlLines.push(...buildCommentBlock(step.comment, 2))
  xmlLines.push(indent(2) + `<DIALOG_STEP ID="${escapeXmlAttribute(step.id)}" topic="${escapeXmlAttribute(step.topic)}">`)
  xmlLines.push(indent(3) + `<IssueSummary>${escapeXmlText(step.issueSummary)}</IssueSummary>`)
  if (step.instructions?.trim()) {
    xmlLines.push(indent(3) + '<DialogStepSpecificInstructions>')
    xmlLines.push(wrapText(step.instructions, 4))
    xmlLines.push(indent(3) + '</DialogStepSpecificInstructions>')
  }
  xmlLines.push(indent(3) + '<AgentInteraction>')
  xmlLines.push(...buildCommentBlock(step.promptComment, 4))
  xmlLines.push(indent(4) + `<Prompt type="${escapeXmlAttribute(step.promptType || 'InitialQuery')}">${escapeXmlText(step.prompt)}</Prompt>`)
  xmlLines.push(...buildEventHandlers(step))
  xmlLines.push(indent(3) + '</AgentInteraction>')
  xmlLines.push(indent(3) + '<ExpectedClassifications>')
  ;(step.classifications || []).forEach((classification) => {
    xmlLines.push(...buildClassification(classification))
  })
  xmlLines.push(indent(3) + '</ExpectedClassifications>')
  xmlLines.push(indent(2) + '</DIALOG_STEP>')
  return xmlLines
}

function buildDiagnosticFlows(steps: Step[], playbook: PlaybookSettings | null = null): string[] {
  const xmlLines: string[] = []
  if (playbook) xmlLines.push(...sectionCommentLines(playbook, 'DIAGNOSTIC_FLOWS'))
  xmlLines.push(indent(1) + '<DIAGNOSTIC_FLOWS>')
  xmlLines.push(...buildEventHandlingBlock())
  steps.forEach((step) => {
    xmlLines.push(...buildDialogStep(step))
  })
  xmlLines.push(indent(1) + '</DIAGNOSTIC_FLOWS>')
  return xmlLines
}

/**
 * Serializes the full playbook (config + steps) into an <LLM_INSTRUCTIONS>
 * XML document — the same schema utils/xmlImport.js parses.
 * @param playbook - a playbook record (see normalizeRecord in store/playbooks.js)
 * @param steps - that playbook's dialog steps
 */
export function buildLlmInstructionsXml(playbook: PlaybookSettings, steps: Step[]): string {
  const xmlLines: string[] = []
  const sectionBuilders: Record<SectionKey, () => string[]> = {
    SETUP: () => buildSetup(playbook),
    GUIDELINES: () => buildGuidelines(playbook),
    DIALOG_CONSTRAINTS: () => buildDialogConstraints(playbook),
    CLARIFICATION_RULES: () => buildClarificationRules(playbook),
    ESCALATION_HANDLING: () => buildEscalationHandling(playbook),
    ROUTING_LOGIC: () => buildRoutingLogic(playbook),
    DIAGNOSTIC_FLOWS: () => buildDiagnosticFlows(steps || [], playbook)
  }
  if (playbook.includeXmlDeclaration !== false) xmlLines.push('<?xml version="1.0" encoding="UTF-8"?>')
  xmlLines.push('<LLM_INSTRUCTIONS>')
  resolveSectionOrder(playbook, steps).forEach((sectionKey) => xmlLines.push(...sectionBuilders[sectionKey]()))
  xmlLines.push('</LLM_INSTRUCTIONS>')
  return xmlLines.join('\n')
}

/**
 * Serializes just the DIAGNOSTIC_FLOWS section (steps only), for cases where
 * only the diagnostic step data — not the surrounding playbook policy — is
 * needed.
 */
export function buildDiagnosticFlowsXml(steps: Step[]): string {
  const xmlLines: string[] = []
  xmlLines.push('<?xml version="1.0" encoding="UTF-8"?>')
  xmlLines.push(...buildDiagnosticFlows(steps).map((line) => line.replace(/^ {4}/, '')))
  return xmlLines.join('\n')
}

/**
 * Triggers a browser download of the given text content.
 */
export function downloadTextFile(filename: string, content: string, mimeType = 'application/xml'): void {
  const blob = new Blob([content], { type: mimeType })
  const blobUrl = URL.createObjectURL(blob)
  const downloadLink = document.createElement('a')
  downloadLink.href = blobUrl
  downloadLink.download = filename
  document.body.appendChild(downloadLink)
  downloadLink.click()
  document.body.removeChild(downloadLink)
  URL.revokeObjectURL(blobUrl)
}

/**
 * "<playbook name>.xml" with filesystem-unsafe characters removed — e.g.
 * "Triage.xml" — used as the Export modal's download filename.
 */
export function exportFileName(playbookName: string): string {
  const cleanedName = String(playbookName || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
  return `${cleanedName || 'playbook'}.xml`
}
