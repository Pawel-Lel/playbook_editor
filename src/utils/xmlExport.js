// Serializes the live stores (playbook config + steps) back into the full
// <LLM_INSTRUCTIONS> XML schema: SETUP, GUIDELINES, DIALOG_CONSTRAINTS,
// CLARIFICATION_RULES_POLICY, ESCALATION_HANDLING and DIAGNOSTIC_FLOWS. The
// inverse of utils/xmlImport.js; the record shape is store/playbooks.js's
// normalizeRecord().

const IND = '    '
const pad = (level) => IND.repeat(level)

function escText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escAttr(value) {
  return escText(value).replace(/"/g, '&quot;')
}

// Wraps long text at ~90 chars per line, re-indented, to mirror the
// hand-wrapped prose formatting used in the source document. Preserves
// existing line breaks (e.g. "- bullet\n- bullet" instruction blocks).
function wrapText(value, level) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  return raw
    .split('\n')
    .map((paragraph) => {
      const words = paragraph.trim().split(/\s+/).filter(Boolean)
      if (!words.length) return ''
      const lines = []
      let line = ''
      words.forEach((word) => {
        if ((line + ' ' + word).trim().length > 90) {
          lines.push(line.trim())
          line = word
        } else {
          line = (line + ' ' + word).trim()
        }
      })
      if (line) lines.push(line.trim())
      return lines.map((l) => pad(level) + escText(l)).join('\n')
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
function buildCommentBlock(text, level) {
  const raw = String(text || '').trim()
  if (!raw) return []
  const out = []
  const paragraphs = raw.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  paragraphs.forEach((p) => {
    const safe = p.replace(/--/g, '\u2013\u2013')
    const sourceLines = safe.split('\n')
    const wrapped = []
    sourceLines.forEach((sourceLine) => {
      const words = sourceLine.trim().split(/\s+/).filter(Boolean)
      if (!words.length) {
        wrapped.push('')
        return
      }
      let line = ''
      words.forEach((word) => {
        if ((line + ' ' + word).trim().length > 86) {
          wrapped.push(line.trim())
          line = word
        } else {
          line = (line + ' ' + word).trim()
        }
      })
      if (line) wrapped.push(line.trim())
    })
    if (wrapped.length === 1) {
      out.push(pad(level) + `<!-- ${wrapped[0]} -->`)
    } else {
      out.push(pad(level) + `<!-- ${wrapped[0]}`)
      for (let i = 1; i < wrapped.length - 1; i++) {
        out.push(wrapped[i] === '' ? '' : pad(level) + wrapped[i])
      }
      out.push(pad(level) + `${wrapped[wrapped.length - 1]} -->`)
    }
  })
  return out
}

// XML comments can't contain "--"; everything else is emitted verbatim
// (comments aren't entity-decoded, so "&" must NOT be escaped here).
function commentSafe(text) {
  return String(text ?? '').replace(/--/g, '\u2013\u2013')
}

// ---------------------------------------------------------------------
// DOCUMENT LAYOUT — which top-level sections are written, in what order,
// and the <!-- ... --> comment above each. A playbook imported from XML
// remembers both (sectionOrder / sectionComments), so e.g. Triage.xml's
// "ESCALATION_HANDLING before CLARIFICATION_RULES" order and its
// "<!-- STEP 1: CLARIFY AMBIGUOUS INPUTS -->" headings survive a round trip.
// ---------------------------------------------------------------------
export const SECTION_KEYS = [
  'SETUP',
  'GUIDELINES',
  'DIALOG_CONSTRAINTS',
  'CLARIFICATION_RULES',
  'ESCALATION_HANDLING',
  'ROUTING_LOGIC',
  'DIAGNOSTIC_FLOWS'
]

export const SECTION_LABELS = {
  SETUP: 'Setup',
  GUIDELINES: 'Guidelines',
  DIALOG_CONSTRAINTS: 'Dialog constraints',
  CLARIFICATION_RULES: 'Clarification rules',
  ESCALATION_HANDLING: 'Escalation handling',
  ROUTING_LOGIC: 'Routing logic',
  DIAGNOSTIC_FLOWS: 'Diagnostic flows (dialog steps)'
}

export const DEFAULT_SECTION_COMMENTS = {
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
function sectionComment(playbook, key) {
  const stored = playbook.sectionComments?.[key]
  return stored === undefined || stored === null ? DEFAULT_SECTION_COMMENTS[key] : stored
}

function sectionCommentLines(playbook, key, level = 1) {
  const text = sectionComment(playbook, key)
  return text?.trim() ? [pad(level) + `<!-- ${commentSafe(text.trim())} -->`] : []
}

function sectionHasContent(playbook, steps, key) {
  switch (key) {
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
export function resolveSectionOrder(playbook, steps) {
  const stored = Array.isArray(playbook.sectionOrder) ? playbook.sectionOrder : []
  const order = []
  stored.forEach((k) => {
    if (SECTION_KEYS.includes(k) && !order.includes(k)) order.push(k)
  })
  if (!order.length) {
    SECTION_KEYS.forEach((k) => {
      if (k === 'GUIDELINES' || sectionHasContent(playbook, steps, k)) order.push(k)
    })
    return order
  }
  SECTION_KEYS.forEach((k, defaultIdx) => {
    if (order.includes(k) || !sectionHasContent(playbook, steps, k)) return
    // insert after the last already-placed section that precedes k by default
    let insertAt = 0
    order.forEach((placed, i) => {
      if (SECTION_KEYS.indexOf(placed) < defaultIdx) insertAt = i + 1
    })
    order.splice(insertAt, 0, k)
  })
  return order
}

// ---------------------------------------------------------------------
// SETUP — CONTEXT_HANDLING and ROLE/OBJECTIVE are two different styles;
// each is only emitted if its fields are actually populated, so either (or
// in principle both) can appear depending on which the playbook uses.
// ---------------------------------------------------------------------
function buildSetup(playbook) {
  const out = []
  out.push(...sectionCommentLines(playbook, 'SETUP'))
  out.push(pad(1) + '<SETUP>')
  out.push(pad(2) + `<PARAMETER_ASSIGNMENT name="param_playbook_name" value="${escAttr(playbook.playbookName)}" />`)
  if (playbook.setup?.role?.trim()) {
    out.push(pad(2) + `<ROLE>${escText(playbook.setup.role)}</ROLE>`)
  }
  if (playbook.setup?.objective?.trim()) {
    out.push(pad(2) + '<OBJECTIVE>')
    out.push(wrapText(playbook.setup.objective, 3))
    out.push(pad(2) + '</OBJECTIVE>')
  }
  if (playbook.setup?.contextInstruction?.trim() || playbook.setup?.contextConstraint?.trim()) {
    out.push(pad(2) + '<CONTEXT_HANDLING>')
    out.push(pad(3) + `<INSTRUCTION>${escText(playbook.setup?.contextInstruction)}</INSTRUCTION>`)
    out.push(pad(3) + '<CONSTRAINT>')
    out.push(wrapText(playbook.setup?.contextConstraint, 4))
    out.push(pad(3) + '</CONSTRAINT>')
    out.push(pad(2) + '</CONTEXT_HANDLING>')
  }
  out.push(pad(1) + '</SETUP>')
  return out
}

// ---------------------------------------------------------------------
// GUIDELINES (POLICY entries) — three shapes (see xmlImport.js's
// parseGuideline): 'text' one-liner, 'structured' (TRIGGER /
// TRIGGER_KEYWORDS / ACTION[text or SET_PARAMETER/INVOKE_FLOW steps] /
// REQUIREMENT / FORMAT), or 'raw' (rawXml emitted verbatim). Records saved
// before `shape` existed have it inferred from which fields are filled.
// ---------------------------------------------------------------------
export function inferPolicyShape(g) {
  if (g.shape === 'text' || g.shape === 'structured' || g.shape === 'raw') return g.shape
  if (g.rawXml?.trim()) return 'raw'
  if (
    g.trigger?.trim() ||
    g.action?.trim() ||
    g.triggerKeywords?.trim() ||
    g.requirement?.trim() ||
    g.format?.trim() ||
    (g.actionSteps || []).length
  ) {
    return 'structured'
  }
  return 'text'
}

function flowRef(name) {
  const n = String(name || '').trim()
  return n.startsWith('${') ? n : `\${FLOW:${n}}`
}

function buildActionStep(step, level) {
  if (step.kind === 'INVOKE_FLOW') {
    return pad(level) + `<INVOKE_FLOW name="${escAttr(flowRef(step.name))}" />`
  }
  const attrs = [`name="${escAttr(step.name)}"`]
  if (step.value !== undefined && step.value !== '') attrs.push(`value="${escAttr(step.value)}"`)
  return pad(level) + `<${step.kind || 'SET_PARAMETER'} ${attrs.join(' ')} />`
}

function buildGuidelinePolicy(g) {
  const out = []
  out.push(...buildCommentBlock(g.comment, 2))
  const shape = inferPolicyShape(g)
  const open = pad(2) + `<POLICY id="${escAttr(g.policyId)}">`
  if (shape === 'raw') {
    out.push(open)
    String(g.rawXml || '').split('\n').forEach((line) => {
      out.push(line.trim() === '' ? '' : pad(3) + line)
    })
    out.push(pad(2) + '</POLICY>')
    return out
  }
  if (shape === 'structured') {
    out.push(open)
    if (g.trigger?.trim()) out.push(pad(3) + `<TRIGGER>${escText(g.trigger)}</TRIGGER>`)
    if (g.triggerKeywords?.trim()) out.push(pad(3) + `<TRIGGER_KEYWORDS>${escText(g.triggerKeywords)}</TRIGGER_KEYWORDS>`)
    const steps = (g.actionSteps || []).filter((st) => String(st.name || '').trim())
    if (steps.length) {
      out.push(pad(3) + '<ACTION>')
      steps.forEach((st) => out.push(buildActionStep(st, 4)))
      out.push(pad(3) + '</ACTION>')
    } else if (g.action?.trim()) {
      out.push(pad(3) + `<ACTION>${escText(g.action)}</ACTION>`)
    }
    if (g.requirement?.trim()) out.push(pad(3) + `<REQUIREMENT>${escText(g.requirement)}</REQUIREMENT>`)
    if (g.format?.trim()) out.push(pad(3) + `<FORMAT>${escText(g.format)}</FORMAT>`)
    out.push(pad(2) + '</POLICY>')
    return out
  }
  out.push(pad(2) + `<POLICY id="${escAttr(g.policyId)}">${escText(g.text)}</POLICY>`)
  return out
}

function buildGuidelines(playbook) {
  const out = []
  out.push(...sectionCommentLines(playbook, 'GUIDELINES'))
  out.push(pad(1) + '<GUIDELINES>')
  ;(playbook.guidelines || []).forEach((g) => out.push(...buildGuidelinePolicy(g)))
  out.push(pad(1) + '</GUIDELINES>')
  return out
}

// ---------------------------------------------------------------------
// DIALOG_CONSTRAINTS
// ---------------------------------------------------------------------
function buildDialogConstraints(playbook) {
  const out = []
  out.push(...sectionCommentLines(playbook, 'DIALOG_CONSTRAINTS'))
  out.push(pad(1) + '<DIALOG_CONSTRAINTS>')
  ;(playbook.dialogConstraints || []).forEach((c) => {
    out.push(pad(2) + `<CONSTRAINT type="${escAttr(c.type)}">`)
    if (c.critical?.trim()) {
      out.push(pad(3) + `<CRITICAL>${escText(c.critical)}</CRITICAL>`)
      if (c.action?.trim()) out.push(pad(3) + `<ACTION>${escText(c.action)}</ACTION>`)
    } else {
      out.push(wrapText(c.text, 3))
    }
    out.push(pad(2) + '</CONSTRAINT>')
  })
  out.push(pad(1) + '</DIALOG_CONSTRAINTS>')
  return out
}

// ---------------------------------------------------------------------
// CLARIFICATION RULES — the plain <CLARIFICATION_RULES_POLICY> wrapper by
// default; if the playbook has its own shared condition, it's wrapped in
// <CLARIFICATION_RULES condition="..."> instead, matching the
// router/triage-style schema. Each RULE's own attribute name (condition vs
// keyword) is preserved per-item.
// ---------------------------------------------------------------------
function buildClarificationRuleEl(r) {
  const out = []
  const attrName = r.attrName === 'keyword' ? 'keyword' : 'condition'
  out.push(...buildCommentBlock(r.comment, 2))
  out.push(pad(2) + `<RULE ${attrName}="${escAttr(r.condition)}">`)
  out.push(pad(3) + `<PROMPT>${escText(r.prompt)}</PROMPT>`)
  if (r.instruction?.trim()) {
    out.push(pad(3) + '<INSTRUCTION>')
    out.push(wrapText(r.instruction, 4))
    out.push(pad(3) + '</INSTRUCTION>')
  }
  out.push(pad(2) + '</RULE>')
  return out
}

function buildClarificationRules(playbook) {
  const out = []
  out.push(...sectionCommentLines(playbook, 'CLARIFICATION_RULES'))
  if (playbook.clarificationRulesCondition?.trim()) {
    out.push(pad(1) + `<CLARIFICATION_RULES condition="${escAttr(playbook.clarificationRulesCondition)}">`)
    ;(playbook.clarificationRules || []).forEach((r) => out.push(...buildClarificationRuleEl(r)))
    out.push(pad(1) + '</CLARIFICATION_RULES>')
  } else {
    out.push(pad(1) + '<CLARIFICATION_RULES_POLICY>')
    ;(playbook.clarificationRules || []).forEach((r) => out.push(...buildClarificationRuleEl(r)))
    out.push(pad(1) + '</CLARIFICATION_RULES_POLICY>')
  }
  return out
}

// ---------------------------------------------------------------------
// ESCALATION_HANDLING
// ---------------------------------------------------------------------
// Global (playbook-level) NoMatch/NoInput reprompts — modeled the same way
// as a classification's <Action> (see buildActionElement below, reused
// directly here), so tool_type/tool_id/Parameter are genuine, independently
// editable fields rather than hardcoded boilerplate.
function buildRepromptBlock(tagName, defaultComment, reprompt, level) {
  const out = []
  const comment = reprompt.comment === undefined || reprompt.comment === null ? defaultComment : reprompt.comment
  out.push(...buildCommentBlock(comment, level))
  out.push(pad(level) + `<${tagName}>`)
  out.push(pad(level + 1) + '<PROMPT>')
  out.push(wrapText(reprompt.prompt, level + 2))
  out.push(pad(level + 1) + '</PROMPT>')
  out.push(...buildActionElement(reprompt.action || {}, level + 1))
  out.push(pad(level) + `</${tagName}>`)
  return out
}

function buildGlobalEventHandlers(playbook) {
  const noMatch = playbook.globalNoMatch || {}
  const noInput = playbook.globalNoInput || {}
  const hasNoMatch = noMatch.prompt?.trim()
  const hasNoInput = noInput.prompt?.trim()
  if (!hasNoMatch && !hasNoInput) return []
  const out = []
  out.push(pad(2) + '<EVENT_HANDLERS>')
  if (hasNoMatch) {
    out.push(...buildRepromptBlock('NO_MATCH', "Reprompt for when the user's input is not understood (No Match)", noMatch, 3))
  }
  if (hasNoInput) {
    out.push(...buildRepromptBlock('NO_INPUT', 'Reprompt for when the user provides no input (No Input)', noInput, 3))
  }
  out.push(pad(2) + '</EVENT_HANDLERS>')
  return out
}

function buildEscalationHandling(playbook) {
  const out = []
  out.push(...sectionCommentLines(playbook, 'ESCALATION_HANDLING'))
  out.push(pad(1) + '<ESCALATION_HANDLING>')
  ;(playbook.escalations || []).forEach((e) => {
    const attrName = e.attrName === 'type' ? 'type' : 'condition'
    out.push(...buildCommentBlock(e.comment, 2))
    out.push(pad(2) + `<ESCALATION ${attrName}="${escAttr(e.condition)}">`)
    if (e.description?.trim()) {
      out.push(pad(3) + '<DESCRIPTION>')
      out.push(wrapText(e.description, 4))
      out.push(pad(3) + '</DESCRIPTION>')
    }
    if (e.trigger?.trim()) {
      out.push(pad(3) + `<TRIGGER>${escText(e.trigger)}</TRIGGER>`)
    }
    out.push(pad(3) + '<ACTION>')
    out.push(
      pad(4) +
        `<create_json_data_object param_escalation_reason="${escAttr(e.escalationReason)}" param_playbook_name="${escAttr(
          e.playbookNameParam?.trim() || playbook.playbookName
        )}" />`
    )
    if (e.note?.trim()) {
      out.push(...buildCommentBlock(`Note: ${e.note.trim()}`, 4))
    }
    out.push(pad(4) + `<INVOKE_FLOW name="\${FLOW:${escText(e.flowName)}}" />`)
    out.push(pad(3) + '</ACTION>')
    out.push(pad(2) + '</ESCALATION>')
  })
  out.push(...buildGlobalEventHandlers(playbook))
  out.push(pad(1) + '</ESCALATION_HANDLING>')
  return out
}

// ---------------------------------------------------------------------
// ROUTING_LOGIC — a router/triage playbook's equivalent of DIAGNOSTIC_FLOWS,
// only emitted when the playbook actually has routing categories.
// ---------------------------------------------------------------------
function buildRoutingLogic(playbook) {
  const categories = playbook.routingCategories || []
  if (!categories.length) return []
  const out = []
  out.push(...sectionCommentLines(playbook, 'ROUTING_LOGIC'))
  out.push(pad(1) + '<ROUTING_LOGIC>')
  categories.forEach((c) => {
    out.push(...buildCommentBlock(c.comment, 2))
    out.push(pad(2) + `<CATEGORY name="${escAttr(c.name)}">`)
    out.push(pad(3) + '<TRIGGERS>')
    out.push(wrapText(c.triggers, 4))
    out.push(pad(3) + '</TRIGGERS>')
    out.push(pad(3) + `<ACTION>${escText(c.action)}</ACTION>`)
    out.push(pad(2) + '</CATEGORY>')
  })
  out.push(pad(1) + '</ROUTING_LOGIC>')
  return out
}

// ---------------------------------------------------------------------
// DIAGNOSTIC_FLOWS
// ---------------------------------------------------------------------
function buildEventHandlingBlock() {
  const out = []
  out.push(pad(2) + '<EVENT_HANDLING>')
  out.push(pad(3) + '<RULE scope="all_dialog_steps" priority="high">')
  out.push(pad(4) + '<TRIGGER>NoInput OR NoMatch event fires in any DIALOG_STEP</TRIGGER>')
  out.push(pad(4) + '<MANDATORY_ACTION>')
  out.push(pad(5) + '<DESCRIPTION>')
  out.push(
    wrapText(
      'Invoke external_memory_redis immediately when a NoInput or NoMatch event is detected, ' +
        'passing the current session ID and any issue context gathered so far. This must occur ' +
        'BEFORE the reprompt dialog response is delivered to the customer.',
      6
    )
  )
  out.push(pad(5) + '</DESCRIPTION>')
  out.push(pad(4) + '</MANDATORY_ACTION>')
  out.push(pad(3) + '</RULE>')
  out.push(pad(2) + '</EVENT_HANDLING>')
  return out
}

function buildRepromptAction(level) {
  const out = []
  out.push(pad(level) + '<Action tool_type="Tool_Invocation" tool_id="external_memory_redis">')
  out.push(
    pad(level + 1) +
      '<Parameter name="session_id">state["$session_id"]</Parameter> Invoke ${TOOL:external_memory_redis}'
  )
  out.push(pad(level) + '</Action>')
  return out
}

function buildEventHandlers(step) {
  const hasNoMatch = !!step.noMatchResponse?.trim()
  const hasNoInput = !!step.noInputResponse?.trim()
  if (!hasNoMatch && !hasNoInput) return []

  const out = []
  out.push(pad(4) + '<EventHandlers>')
  if (hasNoMatch) {
    out.push(pad(5) + '<!-- Reprompt for when the user\'s input is not understood (No Match) -->')
    out.push(pad(5) + '<NoMatch>')
    out.push(pad(6) + `<DialogResponse>${escText(step.noMatchResponse)}</DialogResponse>`)
    out.push(...buildRepromptAction(6))
    out.push(pad(5) + '</NoMatch>')
  }
  if (hasNoInput) {
    out.push(pad(5) + '<!-- Reprompt for when the user provides no input (No Input) -->')
    out.push(pad(5) + '<NoInput>')
    out.push(pad(6) + `<DialogResponse>${escText(step.noInputResponse)}</DialogResponse>`)
    out.push(...buildRepromptAction(6))
    out.push(pad(5) + '</NoInput>')
  }
  out.push(pad(4) + '</EventHandlers>')
  return out
}

function buildActionElement(a, level) {
  const out = []
  const attrs = []
  if (a.toolType) attrs.push(`tool_type="${escAttr(a.toolType)}"`)
  if (a.toolId) attrs.push(`tool_id="${escAttr(a.toolId)}"`)
  if (a.flowId) attrs.push(`flow_id="${escAttr(a.flowId)}"`)

  // Internal_State_Update in the source is self-closing with the parameter
  // baked in as attributes rather than a nested <Parameter> element.
  if (a.toolType === 'Internal_State_Update') {
    if (a.parameterName) attrs.push(`parameter_name="${escAttr(a.parameterName)}"`)
    if (a.parameterValue) attrs.push(`value="${escAttr(a.parameterValue)}"`)
    out.push(pad(level) + `<Action ${attrs.join(' ')} />`)
    return out
  }

  out.push(pad(level) + `<Action ${attrs.join(' ')}>`)
  if (a.parameterName) {
    out.push(pad(level + 1) + `<Parameter name="${escAttr(a.parameterName)}">${escText(a.parameterValue)}</Parameter>`)
  }
  if (a.toolType === 'Flow_Invocation' && a.flowId) {
    out.push(pad(level + 1) + `\${FLOW:${escText(a.flowId)}}`)
  } else if (a.toolType === 'RAG_Retrieval' && a.toolId) {
    out.push(pad(level + 1) + `\${TOOL:${escText(a.toolId)}}`)
  } else if (a.toolType === 'Tool_Invocation' && a.toolId) {
    out.push(pad(level + 1) + `Invoke \${TOOL:${escText(a.toolId)}}`)
  }
  out.push(pad(level) + '</Action>')
  return out
}

function buildClassification(c) {
  const out = []
  out.push(...buildCommentBlock(c.comment, 4))
  const attrs = [`ID="${escAttr(c.classificationId)}"`]
  if (c.nextStep?.trim()) attrs.push(`next_step="${escAttr(c.nextStep)}"`)
  out.push(pad(4) + `<Classification ${attrs.join(' ')}>`)
  if (c.triggerCondition?.trim()) {
    out.push(pad(5) + `<TriggerCondition>${escText(c.triggerCondition)}</TriggerCondition>`)
  }
  if (c.query?.trim()) {
    out.push(pad(5) + `<Parameter name="query">${escText(c.query)}</Parameter>`)
  }
  if (c.dialogResponse?.trim()) {
    out.push(pad(5) + `<DialogResponse>${escText(c.dialogResponse)}</DialogResponse>`)
  }
  ;(c.actions || []).forEach((a) => out.push(...buildActionElement(a, 5)))
  out.push(pad(4) + '</Classification>')
  return out
}

function buildDialogStep(step) {
  const out = []
  out.push(...buildCommentBlock(step.comment, 2))
  out.push(pad(2) + `<DIALOG_STEP ID="${escAttr(step.id)}" topic="${escAttr(step.topic)}">`)
  out.push(pad(3) + `<IssueSummary>${escText(step.issueSummary)}</IssueSummary>`)
  if (step.instructions?.trim()) {
    out.push(pad(3) + '<DialogStepSpecificInstructions>')
    out.push(wrapText(step.instructions, 4))
    out.push(pad(3) + '</DialogStepSpecificInstructions>')
  }
  out.push(pad(3) + '<AgentInteraction>')
  out.push(...buildCommentBlock(step.promptComment, 4))
  out.push(pad(4) + `<Prompt type="${escAttr(step.promptType || 'InitialQuery')}">${escText(step.prompt)}</Prompt>`)
  out.push(...buildEventHandlers(step))
  out.push(pad(3) + '</AgentInteraction>')
  out.push(pad(3) + '<ExpectedClassifications>')
  ;(step.classifications || []).forEach((c) => {
    out.push(...buildClassification(c))
  })
  out.push(pad(3) + '</ExpectedClassifications>')
  out.push(pad(2) + '</DIALOG_STEP>')
  return out
}

function buildDiagnosticFlows(steps, playbook = null) {
  const out = []
  if (playbook) out.push(...sectionCommentLines(playbook, 'DIAGNOSTIC_FLOWS'))
  out.push(pad(1) + '<DIAGNOSTIC_FLOWS>')
  out.push(...buildEventHandlingBlock())
  steps.forEach((step) => {
    out.push(...buildDialogStep(step))
  })
  out.push(pad(1) + '</DIAGNOSTIC_FLOWS>')
  return out
}

/**
 * Serializes the full playbook (config + steps) into an <LLM_INSTRUCTIONS>
 * XML document — the same schema utils/xmlImport.js parses.
 * @param {Object} playbook - a playbook record (see normalizeRecord in store/playbooks.js)
 * @param {Array} steps - that playbook's dialog steps
 * @returns {string}
 */
export function buildLlmInstructionsXml(playbook, steps) {
  const out = []
  const builders = {
    SETUP: () => buildSetup(playbook),
    GUIDELINES: () => buildGuidelines(playbook),
    DIALOG_CONSTRAINTS: () => buildDialogConstraints(playbook),
    CLARIFICATION_RULES: () => buildClarificationRules(playbook),
    ESCALATION_HANDLING: () => buildEscalationHandling(playbook),
    ROUTING_LOGIC: () => buildRoutingLogic(playbook),
    DIAGNOSTIC_FLOWS: () => buildDiagnosticFlows(steps || [], playbook)
  }
  if (playbook.includeXmlDeclaration !== false) out.push('<?xml version="1.0" encoding="UTF-8"?>')
  out.push('<LLM_INSTRUCTIONS>')
  resolveSectionOrder(playbook, steps).forEach((key) => out.push(...builders[key]()))
  out.push('</LLM_INSTRUCTIONS>')
  return out.join('\n')
}

/**
 * Serializes just the DIAGNOSTIC_FLOWS section (steps only), for cases where
 * only the diagnostic step data — not the surrounding playbook policy — is
 * needed.
 * @param {Array} steps
 * @returns {string}
 */
export function buildDiagnosticFlowsXml(steps) {
  const out = []
  out.push('<?xml version="1.0" encoding="UTF-8"?>')
  out.push(...buildDiagnosticFlows(steps).map((line) => line.replace(/^ {4}/, '')))
  return out.join('\n')
}

/**
 * Triggers a browser download of the given text content.
 * @param {string} filename
 * @param {string} content
 * @param {string} mime
 */
export function downloadTextFile(filename, content, mime = 'application/xml') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * "<playbook name>.xml" with filesystem-unsafe characters removed — e.g.
 * "Triage.xml" — used as the Export modal's download filename.
 * @param {string} playbookName
 * @returns {string}
 */
export function exportFileName(playbookName) {
  const cleaned = String(playbookName || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
  return `${cleaned || 'playbook'}.xml`
}
