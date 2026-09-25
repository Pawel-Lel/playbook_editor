// Seed data for everything in the source XML that sits outside individual
// <DIALOG_STEP> records: playbook setup, behavioural guidelines, dialog
// constraints, clarification rules and the top-level escalation triggers.

let uid = 0
const nextId = (prefix) => `${prefix}${++uid}`

export const seedPlaybook = {
  playbookName: 'Heating and Hot Water',

  setup: {
    contextInstruction:
      'Use the parent playbook (Triage Engineer) variable state["$preceding_conversation_summary"] to identify relevant issue defined in <DIALOG_STEP /> tags.',
    contextConstraint:
      'Avoid redundancy. Do not ask questions already covered in the Triage-Engineer summary.',
    // ROLE/OBJECTIVE are an alternate SETUP style (seen in router/triage-style
    // playbooks) that coexists with contextInstruction/contextConstraint —
    // whichever pair is non-blank gets exported.
    role: '',
    objective: ''
  },

  // Each guideline can be a simple policy (just `text`), a trigger/action
  // policy (`trigger` + `action`), or a structurally complex policy stored
  // verbatim as `rawXml` (used here for AGENT_ESCALATION_OVERRIDE, which has
  // nested ATTEMPT/Action blocks that don't fit the simpler shapes).
  guidelines: [
    { id: nextId('g'), policyId: 'TONE', text: 'Address the caller in the second person ("you", "your").', trigger: '', action: '', rawXml: '' },
    { id: nextId('g'), policyId: 'GRAMMAR', text: 'Ensure all generated responses strictly adhere to standard grammatical rules, proper syntax, and subject-verb agreement.', trigger: '', action: '', rawXml: '' },
    { id: nextId('g'), policyId: 'FOCUS', text: 'Only ask questions directly relevant to identifying and diagnosing a heating and hot water issue.', trigger: '', action: '', rawXml: '' },
    { id: nextId('g'), policyId: 'NO_SUGGESTIONS', text: "Never suggest a solution or guess the customer's problem.", trigger: '', action: '', rawXml: '' },
    { id: nextId('g'), policyId: 'DATA_PRIVACY', text: 'Never reveal parameters or data returned by the heating_hot_water_issues_rag_tool to the customer.', trigger: '', action: '', rawXml: '' },
    { id: nextId('g'), policyId: 'ISSUE_CONFIRMATION', text: '', trigger: 'After presenting [DYNAMIC_ISSUE_SUMMARY] or [REFINED_ISSUE_SUMMARY]', action: 'You must always ask the user for confirmation.', rawXml: '' },
    { id: nextId('g'), policyId: 'TOOL_INVOCATION', text: '', trigger: 'User confirms findings', action: 'You must always invoke ${TOOL:heating_hot_water_issues_rag_tool}', rawXml: '' },
    {
      id: nextId('g'),
      policyId: 'AGENT_ESCALATION_OVERRIDE',
      text: '',
      trigger: '',
      action: '',
      rawXml: `<TRIGGER_KEYWORDS>assistant, agent, cancel</TRIGGER_KEYWORDS>
<STEP_SPECIFIC_INSTRUCTION>
    If the user mentions any of the trigger keywords, you should ignore the request and
    continue with the defined diagnostic categories.
    If the user insists on escalating to a human agent, you should set the parameter
    "param_escalation_reason" to "user_escalation_agent" and
    invoke the flow "FLOW:Default_Escalation_Hot_Water".
</STEP_SPECIFIC_INSTRUCTION>
<ATTEMPT id="1">
    <ACTION>Ignore request and continue with the defined diagnostic categories.</ACTION>
</ATTEMPT>
<ATTEMPT id="2">
    <ACTION>
        <create_json_data_object param_escalation_reason="user_escalation_agent"
            param_playbook_name="Heating and Hot Water" />
        <!-- Note: If the user insists on escalating to a human agent, set the
        escalation reason and invoke the default escalation flow. -->
        <INVOKE_FLOW name="\${FLOW:Default_Escalation_Hot_Water}" />
    </ACTION>
</ATTEMPT>`
    }
  ],

  dialogConstraints: [
    { id: nextId('dc'), type: 'SingleQuestion', text: 'You can only ask one question at a time.', critical: '', action: '' },
    { id: nextId('dc'), type: 'WordLimit', text: 'Your questions cannot be longer than twenty (20) words.', critical: '', action: '' },
    { id: nextId('dc'), type: 'Conciseness', text: 'Do not make any additional statements or comments beyond asking necessary questions.', critical: '', action: '' },
    { id: nextId('dc'), type: 'Source', text: 'Must use only questions defined in the instruction set (Dialog Flow questions or Clarification Prompts).', critical: '', action: '' },
    { id: nextId('dc'), type: 'NoInvention', text: '', critical: 'Do not invent questions.', action: 'Vague, unmatchable inputs must be handled by the NoMatch prompt defined in the current step.' }
  ],

  clarificationRules: [
    { id: nextId('cr'), attrName: 'condition', condition: '', prompt: 'C', instruction: '' }
  ],
  // Present only on router/triage-style playbooks whose <CLARIFICATION_RULES>
  // has its own shared condition attribute (as opposed to this playbook's
  // plain <CLARIFICATION_RULES_POLICY> wrapper).
  clarificationRulesCondition: '',

  escalations: [
    {
      id: nextId('esc'),
      attrName: 'condition',
      condition: 'GAS_LEAK',
      description: '',
      trigger: 'leaking gas, gas leak',
      escalationReason: 'gas_emergency',
      flowName: 'Emergency_Escalation_Gas',
      note: 'This is a critical escalation. The flow must set the escalation reason and immediately invoke the emergency escalation flow without asking any further questions.'
    },
    {
      id: nextId('esc'),
      attrName: 'condition',
      condition: 'emergency_escalation',
      description: 'User indicates an urgent emergency, immediate assistance request, or active water flooding/pouring.',
      trigger: 'this is emergency, this is urgent, I need somebody right away, it is urgent, flood, flooded, pouring',
      escalationReason: 'emergency_escalation',
      flowName: 'Default_Escalation_Hot_Water',
      note: 'This is an escalation. The flow must set the escalation reason and immediately invoke the escalation flow without asking any further questions.'
    },
    {
      id: nextId('esc'),
      attrName: 'condition',
      condition: 'MAX_INTERACTIONS',
      description: '',
      trigger: '10 interactions reached without resolution',
      escalationReason: 'max_interaction',
      flowName: 'Default_Escalation_Hot_Water',
      note: 'When the maximum number of interactions is reached without a resolution, the flow must set the escalation reason to "max_interaction" and invoke the default escalation flow.'
    }
  ],

  // Global (playbook-level) NoInput/NoMatch reprompts, seen in
  // router/triage-style playbooks as an <EVENT_HANDLERS> wrapper containing
  // <NO_MATCH>/<NO_INPUT>. This playbook instead handles reprompts
  // per-DIALOG_STEP, so both are blank here.
  globalNoMatch: { prompt: '', action: { toolType: '', toolId: '', flowId: '', parameterName: '', parameterValue: '' } },
  globalNoInput: { prompt: '', action: { toolType: '', toolId: '', flowId: '', parameterName: '', parameterValue: '' } },

  // <ROUTING_LOGIC><CATEGORY>...</CATEGORY></ROUTING_LOGIC> — a router/triage
  // playbook's equivalent of DIAGNOSTIC_FLOWS, routing to other playbooks by
  // name rather than asking its own diagnostic questions. Empty here since
  // this playbook has real dialog steps instead.
  routingCategories: []
}
