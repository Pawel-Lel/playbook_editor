// The shapes of the app's data, in one place. Every store, component and
// XML function imports its types from here, so a field added to a playbook
// only has to be described once.
//
// `interface` describes an object's fields; `type X = 'a' | 'b'` means "a
// string that is exactly 'a' or 'b'". A `?` after a field name means the
// field may be missing.

// ---- Dialog steps -------------------------------------------------------

/** One <Action> inside a classification (or inside a global reprompt). */
export interface Action {
  id?: string
  toolType: string // e.g. 'Flow_Invocation', 'RAG_Retrieval', 'Tool_Invocation', 'Internal_State_Update'
  toolId: string
  flowId: string
  parameterName: string
  parameterValue: string
}

/** One possible answer to a dialog step, and where it leads. */
export interface Classification {
  id: string
  classificationId: string
  nextStep: string // id of the step (or external target) this answer goes to
  triggerCondition: string
  query: string
  dialogResponse: string
  comment: string
  actions: Action[]
}

/** One <DIALOG_STEP>. */
export interface Step {
  id: string
  topic: string
  issueSummary: string
  instructions: string
  comment: string
  promptType: string // 'InitialQuery' | 'ConfirmationQuery' | 'InternalProcessing'
  promptComment: string
  prompt: string
  noMatchResponse: string
  noInputResponse: string
  classifications: Classification[]
}

/** What a flow-map node / "next step" suggestion can be. */
export type TargetKind = 'step' | 'terminal' | 'flow' | 'unknown' | 'dynamic'

export interface Target {
  id: string
  kind: TargetKind
  label: string
}

// ---- Playbook settings --------------------------------------------------

export interface Setup {
  contextInstruction: string
  contextConstraint: string
  role: string
  objective: string
}

/** A <SET_PARAMETER> or <INVOKE_FLOW> row inside a structured policy's <ACTION>. */
export interface ActionStep {
  id: string
  kind: string // 'SET_PARAMETER' | 'INVOKE_FLOW'
  name: string
  value: string
}

export type PolicyShape = 'text' | 'structured' | 'raw'

/** One <POLICY> in <GUIDELINES>. Which fields matter depends on `shape`. */
export interface Guideline {
  id: string
  policyId: string
  shape: PolicyShape
  comment: string
  text: string // shape 'text'
  trigger: string // shape 'structured' ...
  triggerKeywords: string
  action: string
  actionSteps: ActionStep[]
  requirement: string
  format: string
  rawXml: string // shape 'raw'
}

export interface DialogConstraint {
  id: string
  type: string
  text: string
  critical: string
  action: string
}

export interface ClarificationRule {
  id: string
  attrName: 'condition' | 'keyword' // which XML attribute holds `condition`
  condition: string
  prompt: string
  instruction: string
  comment: string
}

export interface Escalation {
  id: string
  attrName: 'condition' | 'type' // which XML attribute holds `condition`
  condition: string
  comment: string
  description: string
  trigger: string
  escalationReason: string
  playbookNameParam: string // blank = use the playbook's own name
  flowName: string
  note: string
}

export interface RoutingCategory {
  id: string
  name: string
  comment: string
  triggers: string
  action: string // e.g. "Route to ${PLAYBOOK:Shower Issues}"
}

/** A playbook-level NoMatch / NoInput reprompt. */
export interface GlobalReprompt {
  comment?: string // missing = the exporter's default comment
  prompt: string
  action: Action
}

/** The top-level XML sections, in their default order. */
export type SectionKey =
  | 'SETUP'
  | 'GUIDELINES'
  | 'DIALOG_CONSTRAINTS'
  | 'CLARIFICATION_RULES'
  | 'ESCALATION_HANDLING'
  | 'ROUTING_LOGIC'
  | 'DIAGNOSTIC_FLOWS'

// ---- Whole playbook -----------------------------------------------------

/** Everything xmlExport needs from the playbook side (steps are passed separately). */
export interface PlaybookSettings {
  playbookName: string
  setup: Setup
  guidelines: Guideline[]
  dialogConstraints: DialogConstraint[]
  clarificationRules: ClarificationRule[]
  clarificationRulesCondition: string
  escalations: Escalation[]
  globalNoMatch: GlobalReprompt
  globalNoInput: GlobalReprompt
  routingCategories: RoutingCategory[]
  sectionOrder: SectionKey[]
  sectionComments: Partial<Record<SectionKey, string>> // Partial = any key may be missing
  includeXmlDeclaration: boolean
}

/** What xmlImport's parsePlaybookXml() returns for one file. */
export interface ParsedPlaybook extends PlaybookSettings {
  steps: Step[]
}

/** One playbook as stored in the app (and in localStorage). */
export interface PlaybookRecord extends ParsedPlaybook {
  id: string
  sourceObjectPath: string // its file's path in the bucket, once it has one
  localFileName: string // its file's name on this computer, once it has one
}

/** A file that couldn't be loaded, and why. */
export interface FileError {
  name: string
  message: string
}
