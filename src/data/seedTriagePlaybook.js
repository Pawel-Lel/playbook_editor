// Raw playbook-level config for the seeded "Triage" example playbook — a
// router/triage-style playbook that routes to other playbooks by category
// rather than asking its own diagnostic questions, so it has no dialog
// steps of its own. Shape mirrors seedPlaybook.js (same fields; id,
// sourceObjectPath and steps are added by playbooks.js when it builds a
// full record from this).
//
// This is a field-for-field capture of Triage.xml: the section order and
// section comments, every POLICY (including the structured
// CANCELLATION_OVERRIDE / HANDOFF_SUMMARY bodies), every escalation with its
// own comment and Note, the EVENT_HANDLERS reprompts with their comments and
// Action, all 20 keyword rules and all 10 routing categories. Exporting it
// reproduces Triage.xml (modulo whitespace/line-wrapping), and importing
// Triage.xml yields exactly this data.

let uid = 0
const nextId = (prefix) => `${prefix}_${++uid}`

// Plain one-line <POLICY>.
const textPolicy = (policyId, text) => ({
  id: nextId('g'),
  policyId,
  shape: 'text',
  comment: '',
  text,
  trigger: '',
  triggerKeywords: '',
  action: '',
  actionSteps: [],
  requirement: '',
  format: '',
  rawXml: ''
})

export const seedTriagePlaybook = {
  playbookName: 'Triage',

  // Triage.xml has no <?xml ...?> declaration, and lists ESCALATION_HANDLING
  // before CLARIFICATION_RULES — both preserved on export.
  includeXmlDeclaration: false,
  sectionOrder: ['SETUP', 'GUIDELINES', 'ESCALATION_HANDLING', 'CLARIFICATION_RULES', 'ROUTING_LOGIC'],
  sectionComments: {
    SETUP: 'SETUP AND PERSONA',
    GUIDELINES: 'CORE GUIDELINES & CONSTRAINTS',
    ESCALATION_HANDLING: 'ERROR HANDLING AND ESCALATION',
    CLARIFICATION_RULES: 'STEP 1: CLARIFY AMBIGUOUS INPUTS',
    ROUTING_LOGIC: 'STEP 2: CATEGORIZATION & ROUTING'
  },

  setup: {
    contextInstruction: '',
    contextConstraint: '',
    role: 'Triage Engineer',
    objective:
      'Efficiently identify the correct maintenance - issue category and route the case to the ' +
      'appropriate specialized workflow, without engaging in small talk. If the category cannot ' +
      'be confidently determined, do not guess; escalate strictly according to the escalation ' +
      'instructions.'
  },

  guidelines: [
    textPolicy(
      'FOCUS',
      'Ask only questions directly relevant to identifying the issue and category. Do not make additional statements or offer advice.'
    ),
    textPolicy(
      'GRAMMAR',
      'Ensure all generated responses strictly adhere to standard grammatical rules, proper syntax, and subject-verb agreement.'
    ),
    textPolicy('CONCISENESS', 'Be brief. Cease interaction and route immediately once a category is identified.'),
    textPolicy('SPECIFICITY', 'Always follow the most specific rule that applies to the input.'),
    textPolicy(
      'SESSION_MANAGEMENT',
      'Never proactively end the session. Do not transfer to live agent unless via defined escalation.'
    ),
    textPolicy(
      'MULTI_ISSUE_ESCALATION',
      'If the user reports multiple distinct issues simultaneously (e.g., "leak from radiator and toilet"), you must immediately escalate to ${FLOW:Default_Escalation_Triage}.'
    ),
    {
      // <TRIGGER_KEYWORDS> + <ACTION> made of <SET_PARAMETER>/<INVOKE_FLOW> steps
      ...textPolicy('CANCELLATION_OVERRIDE', ''),
      shape: 'structured',
      triggerKeywords: 'assistant, agent, cancel, advisor',
      actionSteps: [
        { id: nextId('as'), kind: 'SET_PARAMETER', name: 'param_escalation_reason', value: 'user_escalation_agent' },
        { id: nextId('as'), kind: 'INVOKE_FLOW', name: 'Default_Escalation_Triage', value: '' }
      ]
    },
    {
      // <REQUIREMENT> + <FORMAT>
      ...textPolicy('HANDOFF_SUMMARY', ''),
      shape: 'structured',
      requirement: 'Before invoking a playbook or escalating, generate a JSON-style summary.',
      format: '{"preceding_conversation_summary": "Customer has [Issue Details]"}'
    }
  ],

  dialogConstraints: [],

  clarificationRules: [
    { id: nextId('cr'), attrName: 'keyword', condition: 'ligths, lights issue', prompt: 'Could you please describe the issue you are experiencing?', instruction: '', comment: '' },
    { id: nextId('cr'), attrName: 'keyword', condition: 'toilet, toilet issue', prompt: 'Could you please describe the issue you are experiencing?', instruction: '', comment: '' },
    { id: nextId('cr'), attrName: 'keyword', condition: 'claim, new claim', prompt: 'Could you please describe the issue you are experiencing?', instruction: '', comment: '' },
    { id: nextId('cr'), attrName: 'keyword', condition: 'bathroom', prompt: 'Could you please describe the issue you are experiencing?', instruction: '', comment: '' },
    { id: nextId('cr'), attrName: 'keyword', condition: 'tap, taps, water tap', prompt: 'Could you please describe what the issue is with your taps?', instruction: '', comment: '' },
    {
      id: nextId('cr'),
      attrName: 'keyword',
      condition: 'Water leak, Leak',
      prompt: 'To help me understand the issue better, can you please clarify what is leaking?',
      instruction: 'If the user does not know, is unsure, or cannot explicitly identify the source of the leak, route them to the **Generic Leaks playbook**.',
      comment: ''
    },
    { id: nextId('cr'), attrName: 'keyword', condition: 'Shower', prompt: 'Could you please describe the issue you are experiencing with your shower?', instruction: '', comment: '' },
    { id: nextId('cr'), attrName: 'keyword', condition: 'Plug, My plug', prompt: 'Could you please clarify if the issue is related to an electrical plug or a drain plug?', instruction: '', comment: '' },
    { id: nextId('cr'), attrName: 'keyword', condition: 'Drain, Broken Drain', prompt: 'Could you please clarify, do you have an issue with a leaking drain or a blocked drain?', instruction: '', comment: '' },
    { id: nextId('cr'), attrName: 'keyword', condition: 'Pipe', prompt: 'Could you please clarify, do you have a leaking pipe or a blocked pipe?', instruction: '', comment: '' },
    { id: nextId('cr'), attrName: 'keyword', condition: 'Plumber, Plumbing', prompt: 'Please can you provide more details on the plumbing issue you are experiencing?', instruction: '', comment: '' },
    { id: nextId('cr'), attrName: 'keyword', condition: 'Locksmith', prompt: 'Could you please describe the issue you are experiencing?', instruction: '', comment: '' },
    { id: nextId('cr'), attrName: 'keyword', condition: 'Book a repair', prompt: 'Could you please describe the issue you are experiencing?', instruction: '', comment: '' },
    { id: nextId('cr'), attrName: 'keyword', condition: 'Thermostat', prompt: 'Could you please describe the issue you are experiencing?', instruction: '', comment: '' },
    { id: nextId('cr'), attrName: 'keyword', condition: 'Fixing, Needs fixing', prompt: 'Could you please describe what needs fixing?', instruction: '', comment: '' },
    { id: nextId('cr'), attrName: 'keyword', condition: 'Boiler, Boiler issue, Boiler problem ', prompt: 'Could you please describe the boiler issue you are experiencing?', instruction: '', comment: '' },
    { id: nextId('cr'), attrName: 'keyword', condition: "'Low water pressure', 'Low pressure'", prompt: 'Could you please clarify, do you have low pressure on your boiler or low water pressure?', instruction: '', comment: '' },
    { id: nextId('cr'), attrName: 'keyword', condition: 'Washing machine, washing machine not working', prompt: 'Could you please describe what the issue is with your washing machine?', instruction: '', comment: '' },
    { id: nextId('cr'), attrName: 'keyword', condition: 'Dishwasher, Dishwasher not working', prompt: 'Could you please describe what the issue is with your dishwasher?', instruction: '', comment: '' },
    { id: nextId('cr'), attrName: 'keyword', condition: 'Fridge freezer, Fridge, Fridge freezer not working, Fridge not working', prompt: 'Could you please describe what the issue is with your fridge freezer?', instruction: '', comment: '' }
  ],
  clarificationRulesCondition: 'user_response_is_unclear OR lacks_specific_details',

  // Three <ESCALATION> entries (each with the XML comment that sits above
  // it, e.g. "<!-- Gas Emergency -->", and the "Note:" comment inside its
  // ACTION) plus the <EVENT_HANDLERS><NO_MATCH>/<NO_INPUT></EVENT_HANDLERS>
  // reprompt block. playbookNameParam is the create_json_data_object's
  // param_playbook_name — blank means "use this playbook's name" ("Triage").
  escalations: [
    {
      id: nextId('esc'),
      attrName: 'type',
      condition: 'GAS_LEAK',
      comment: 'Gas Emergency',
      description: '',
      trigger: 'leaking gas, gas leak',
      escalationReason: 'gas_emergency',
      playbookNameParam: '',
      flowName: 'Emergency_Escalation_Gas',
      note: 'This is a critical escalation. The flow must set the escalation reason and immediately invoke the emergency escalation flow without asking any further questions.'
    },
    {
      id: nextId('esc'),
      attrName: 'condition',
      condition: 'emergency_escalation',
      comment: '',
      description: 'User indicates an urgent emergency, immediate assistance request, or active water flooding/pouring.',
      trigger: 'this is emergency, this is urgent, I need somebody right away, it is urgent, flood, flooded, pouring',
      escalationReason: 'emergency_escalation',
      playbookNameParam: '',
      flowName: 'Default_Escalation_Triage',
      note: 'This is an escalation. The flow must set the escalation reason and immediately invoke the escalation flow without asking any further questions.'
    },
    {
      id: nextId('esc'),
      attrName: 'type',
      condition: 'MAX_INTERACTIONS',
      comment: 'Max Interactions',
      description: '',
      trigger: '10 interactions reached without resolution',
      escalationReason: 'max_interaction',
      playbookNameParam: '',
      flowName: 'Default_Escalation_Triage',
      note: 'This is a critical escalation. The flow must set the escalation reason and immediately invoke the emergency escalation flow without asking any further questions.'
    }
  ],
  // Each Action's fields — toolType/toolId/parameterName/parameterValue —
  // are genuine, independently editable data (mirroring a classification
  // action's shape), not hardcoded on export.
  globalNoMatch: {
    comment: "Reprompt for when the user's input is not understood (No Match)",
    prompt:
      "Sorry, I didn't catch a response there, [Use the PROMPT defined in the matched RULE. Do not substitute or rephrase it.]",
    action: {
      toolType: 'Tool_Invocation',
      toolId: 'external_memory_redis',
      flowId: '',
      parameterName: 'session_id',
      parameterValue: 'state["$session_id"]'
    }
  },
  globalNoInput: {
    comment: 'Reprompt for when the user provides no input (No Input)',
    prompt:
      "Sorry, I didn't catch a response there, [Use the PROMPT defined in the matched RULE. Do not substitute or rephrase it.]",
    action: {
      toolType: 'Tool_Invocation',
      toolId: 'external_memory_redis',
      flowId: '',
      parameterName: 'session_id',
      parameterValue: 'state["$session_id"]'
    }
  },

  routingCategories: [
    {
      id: nextId('rc'),
      comment: '',
      name: 'Shower Issues (Non-Blockage)',
      triggers:
        'no power to electric shower, electric shower does not turn on, electric shower not heating up, ' +
        'low water flow caused by electric shower, power shower not heating up, low water flow caused by ' +
        'power shower, Leaking shower waste pipe, leaking shower tray, digital shower not working, mixer ' +
        'shower, shower pump, electric shower replacement, leaking electric shower',
      action: 'Route to ${PLAYBOOK:Shower Issues}'
    },
    {
      id: nextId('rc'),
      comment: '',
      name: 'Central Heating Leaks',
      triggers: 'Boiler leak, boiler pipework leak, leaking radiator, leaking radiator pipework, leaking water tank, water heater',
      action: 'Route to ${PLAYBOOK:Central Heating Leaks}'
    },
    {
      id: nextId('rc'),
      comment: '',
      name: 'Heating and Hot Water Issues (Non-Leak)',
      triggers:
        'Heating, no heating, no hot water, boiler not working correctly, single radiator not heating, ' +
        "all radiators not heating, boiler making noises, immersion heater, hot water, noisy boiler, " +
        "thermostat not working correctly, boiler low pressure, boiler doesn't stop filing up, faulty smart thermostat",
      action: 'Route to ${PLAYBOOK:Heating and Hot Water}'
    },
    {
      id: nextId('rc'),
      comment: '',
      name: 'Generic Leaks',
      triggers:
        'Emergency leak, overflow, water loss, no water in a house, drain leak, leaking pipe, water pipe ' +
        'leak, waste pipe leak, leaking sewage pipe, leaking soil pipe, leaking drain, leaking sewerage ' +
        'drain, leaking rainwater drain, rain water pipe or guttering, noisy water pipework, ceiling leak, ' +
        'floor leak, source of the leak unknown',
      action: 'Route to ${PLAYBOOK:Generic Leaks}'
    },
    {
      id: nextId('rc'),
      comment: '',
      name: 'Appliances',
      triggers:
        'Toilet not flushing, leaking fridge freezer (or feed pipe), leaking washing machine (or feed ' +
        'pipe), leaking dishwasher, leaking sink (or waste pipe), leaking bath (or waste pipe), leaking ' +
        'shower (or waste pipe), leaking toilet (bowl, waste pipe, or cistern), leaking bath ' +
        '(bathtub/fixture itself or the waste pipe (drainage) underneath)',
      action: 'Route to ${PLAYBOOK:Appliances}'
    },
    {
      id: nextId('rc'),
      comment: '',
      name: 'Water Taps',
      triggers:
        'standard taps, kitchen taps, kitchen mixer taps, hot water tap, cold water tap tap mixers, ' +
        'bathroom taps, shower taps, standard water tap, garden tap, stop tap, stopcock, leaking kitchen tap, faulty tap',
      action: 'Route to ${PLAYBOOK:Water Taps}'
    },
    {
      id: nextId('rc'),
      comment: '',
      name: 'Plumbing Blockages',
      triggers:
        'Blockage, Plug stuck (shower/sink/bath), blocked toilet, blocked drain, drain blockage, smelly ' +
        'drain, blockage, blocked pipe, stuck plug,',
      action: 'Route to ${PLAYBOOK:Plumbing Blockages}'
    },
    {
      id: nextId('rc'),
      comment: '',
      name: 'Electrical Issues',
      triggers:
        'Appliance faults, washing machine not working, fridge freezer not working, dishwasher not ' +
        'working, extractor fan not working, fuse tripping, socket issues, loss of power, lights not ' +
        'working, light fitting, light switch/bulb issues, EV charger, buzzing sounds with power loss, ' +
        'thermostat adjustment, dimmer switch, extractor fan, smoke alarm',
      action: 'Route to ${PLAYBOOK:Electrical Issues}'
    },
    {
      id: nextId('rc'),
      comment: '',
      name: 'House Security (Doors, Windows and Roof)',
      triggers: 'Locksmith, broken window/frame, broken door/frame, broken lock, snapped key, lost keys, security issues, roof leak',
      action: 'Route to ${PLAYBOOK:House Security}'
    },
    {
      id: nextId('rc'),
      comment: '',
      name: 'Pest Control',
      triggers: 'Pests, rats, mice, wasps, hornets, cockroaches',
      action: 'Route to ${PLAYBOOK:Pest Control}'
    }
  ]
}
