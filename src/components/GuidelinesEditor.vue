<script setup lang="ts">
// CRUD for <GUIDELINES><POLICY> entries, shared by both Playbook Settings
// layouts. Each policy has an explicit shape so only the fields that will
// actually be exported are shown:
//  - text:       <POLICY id="FOCUS">plain text</POLICY>
//  - structured: TRIGGER / TRIGGER_KEYWORDS / ACTION / REQUIREMENT / FORMAT,
//                where ACTION is plain text or a list of <SET_PARAMETER> /
//                <INVOKE_FLOW> steps (Triage's CANCELLATION_OVERRIDE and
//                HANDOFF_SUMMARY)
//  - raw:        verbatim XML body, for anything else
import { usePlaybookStore } from '../store/playbook'
import { structurePolicyBody } from '../utils/xmlImport'
import { inferPolicyShape } from '../utils/xmlExport'
import ItemToolbar from './ItemToolbar.vue'
import type { Guideline, PolicyShape } from '../types'

// Props: inputs from the parent, e.g. <GuidelinesEditor id-placeholder="e.g. TONE" />
// (kebab-case in the template = camelCase here).
withDefaults(defineProps<{ idPlaceholder?: string }>(), { idPlaceholder: 'e.g. FOCUS' })

const playbookStore = usePlaybookStore()

// The guideline's shape ('text' | 'structured' | 'raw'), working it out
// from its filled-in fields the first time if it was never set.
function shapeOf(guideline: Guideline): PolicyShape {
  if (!guideline.shape) guideline.shape = inferPolicyShape(guideline)
  return guideline.shape
}

// "Convert to structured fields": parse the raw XML body into fields.
function convertRawToStructured(guideline: Guideline): void {
  const structuredFields = structurePolicyBody(guideline.rawXml)
  if (!structuredFields) {
    alert("This XML body doesn't fit the structured fields (TRIGGER, TRIGGER_KEYWORDS, ACTION, REQUIREMENT, FORMAT), so it stays as raw XML.")
    return
  }
  Object.assign(guideline, structuredFields, { shape: 'structured' })
}
</script>

<template>
  <section class="panel form-section">
    <div class="section-header">
      <h3>Guidelines <span class="count mono">{{ playbookStore.guidelines.value.length }}</span></h3>
      <button type="button" class="btn btn-secondary" @click="playbookStore.addItem('guidelines')">+ Add policy</button>
    </div>
    <p v-if="!playbookStore.guidelines.value.length" class="hint">No policies yet.</p>
    <div v-for="(guideline, guidelineIndex) in playbookStore.guidelines.value" :key="guideline.id" class="item-row">
      <ItemToolbar
        :index="guidelineIndex"
        :total="playbookStore.guidelines.value.length"
        :label="guideline.policyId"
        @up="playbookStore.moveItem('guidelines', guideline.id, -1)"
        @down="playbookStore.moveItem('guidelines', guideline.id, 1)"
        @remove="playbookStore.removeItem('guidelines', guideline.id)"
      />
      <div class="grid-2">
        <div class="field">
          <label>Policy ID</label>
          <input v-model="guideline.policyId" type="text" :placeholder="idPlaceholder" />
        </div>
        <div class="field">
          <label>Shape</label>
          <select :value="shapeOf(guideline)" @change="guideline.shape = ($event.target as HTMLSelectElement).value as PolicyShape">
            <option value="text">Plain text</option>
            <option value="structured">Structured (trigger / keywords / action / requirement / format)</option>
            <option value="raw">Raw XML</option>
          </select>
        </div>
      </div>

      <div v-if="shapeOf(guideline) === 'text'" class="field">
        <label>Text</label>
        <textarea v-model="guideline.text" rows="2" placeholder="e.g. Ask only questions directly relevant to identifying the issue."></textarea>
      </div>

      <template v-else-if="shapeOf(guideline) === 'structured'">
        <div class="grid-2">
          <div class="field">
            <label>Trigger <span class="optional">(&lt;TRIGGER&gt;)</span></label>
            <input v-model="guideline.trigger" type="text" placeholder="e.g. User confirms findings" />
          </div>
          <div class="field">
            <label>Trigger keywords <span class="optional">(&lt;TRIGGER_KEYWORDS&gt;)</span></label>
            <input v-model="guideline.triggerKeywords" type="text" placeholder="e.g. assistant, agent, cancel, advisor" />
          </div>
        </div>

        <div class="field">
          <label>
            Action <span class="optional">(&lt;ACTION&gt; — plain text, or the steps below; steps win if both are set)</span>
          </label>
          <input v-model="guideline.action" type="text" placeholder="e.g. You must always invoke ..." :disabled="(guideline.actionSteps || []).length > 0" />
        </div>
        <!-- The <ACTION>'s steps, one row each (v-for inside the guideline's v-for). -->
        <div class="steps-box">
          <div v-for="(actionStep, actionStepIndex) in guideline.actionSteps" :key="actionStep.id" class="step-row">
            <span class="mono item-index">{{ actionStepIndex + 1 }}</span>
            <select v-model="actionStep.kind" class="step-kind">
              <option value="SET_PARAMETER">SET_PARAMETER</option>
              <option value="INVOKE_FLOW">INVOKE_FLOW</option>
            </select>
            <input
              v-model="actionStep.name"
              type="text"
              :placeholder="actionStep.kind === 'INVOKE_FLOW' ? 'Flow name, e.g. Default_Escalation_Triage' : 'Parameter, e.g. param_escalation_reason'"
            />
            <input v-if="actionStep.kind !== 'INVOKE_FLOW'" v-model="actionStep.value" type="text" placeholder="Value, e.g. user_escalation_agent" />
            <span v-else class="hint flow-hint mono">→ ${FLOW:{{ actionStep.name || '…' }}}</span>
            <button type="button" class="btn btn-ghost" @click="playbookStore.removeActionStep(guideline.id, actionStep.id)">✕</button>
          </div>
          <div class="step-add">
            <button type="button" class="btn btn-ghost" @click="playbookStore.addActionStep(guideline.id, 'SET_PARAMETER')">+ SET_PARAMETER</button>
            <button type="button" class="btn btn-ghost" @click="playbookStore.addActionStep(guideline.id, 'INVOKE_FLOW')">+ INVOKE_FLOW</button>
          </div>
        </div>

        <div class="field">
          <label>Requirement <span class="optional">(&lt;REQUIREMENT&gt;)</span></label>
          <textarea v-model="guideline.requirement" rows="2" placeholder="e.g. Before invoking a playbook or escalating, generate a JSON-style summary."></textarea>
        </div>
        <div class="field">
          <label>Format <span class="optional">(&lt;FORMAT&gt;)</span></label>
          <input v-model="guideline.format" type="text" class="mono" placeholder='e.g. {"preceding_conversation_summary": "Customer has [Issue Details]"}' />
        </div>
      </template>

      <div v-else class="field">
        <label>
          Raw XML body
          <button type="button" class="btn btn-ghost btn-inline" @click="convertRawToStructured(guideline)">Convert to structured fields</button>
        </label>
        <textarea v-model="guideline.rawXml" rows="6" class="mono raw-xml" placeholder="&lt;TRIGGER_KEYWORDS&gt;...&lt;/TRIGGER_KEYWORDS&gt;"></textarea>
      </div>

      <div class="field">
        <label>Comment <span class="optional">(optional — exported as &lt;!-- ... --&gt; above this POLICY)</span></label>
        <input v-model="guideline.comment" type="text" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.steps-box {
  border: 1px dashed var(--line);
  border-radius: 4px;
  padding: 0.6rem 0.7rem 0.3rem;
  margin: -0.4rem 0 1rem;
  background: #fff;
}
.step-row {
  display: grid;
  grid-template-columns: 1.5rem 11rem 1fr 1fr auto;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 0.5rem;
}
.step-kind { font-family: var(--font-mono, monospace); font-size: 0.8rem; }
.flow-hint { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.step-add { display: flex; gap: 0.4rem; }
.btn-inline { padding: 0 0.4rem; margin-left: 0.5rem; font-size: 0.75rem; }
@media (max-width: 720px) {
  .step-row { grid-template-columns: 1fr; }
}
</style>
