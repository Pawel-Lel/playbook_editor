<script setup>
// CRUD for <GUIDELINES><POLICY> entries, shared by both Playbook Settings
// layouts. Each policy has an explicit shape so only the fields that will
// actually be exported are shown:
//  - text:       <POLICY id="FOCUS">plain text</POLICY>
//  - structured: TRIGGER / TRIGGER_KEYWORDS / ACTION / REQUIREMENT / FORMAT,
//                where ACTION is plain text or a list of <SET_PARAMETER> /
//                <INVOKE_FLOW> steps (Triage's CANCELLATION_OVERRIDE and
//                HANDOFF_SUMMARY)
//  - raw:        verbatim XML body, for anything else
import { usePlaybookStore } from '../store/playbook.js'
import { structurePolicyBody } from '../utils/xmlImport.js'
import { inferPolicyShape } from '../utils/xmlExport.js'
import ItemToolbar from './ItemToolbar.vue'

defineProps({
  idPlaceholder: { type: String, default: 'e.g. FOCUS' }
})

const playbook = usePlaybookStore()

function shapeOf(g) {
  if (!g.shape) g.shape = inferPolicyShape(g)
  return g.shape
}

function convertRaw(g) {
  const fields = structurePolicyBody(g.rawXml)
  if (!fields) {
    alert("This XML body doesn't fit the structured fields (TRIGGER, TRIGGER_KEYWORDS, ACTION, REQUIREMENT, FORMAT), so it stays as raw XML.")
    return
  }
  Object.assign(g, fields, { shape: 'structured' })
}
</script>

<template>
  <section class="panel form-section">
    <div class="section-header">
      <h3>Guidelines <span class="count mono">{{ playbook.guidelines.value.length }}</span></h3>
      <button type="button" class="btn btn-secondary" @click="playbook.addItem('guidelines')">+ Add policy</button>
    </div>
    <p v-if="!playbook.guidelines.value.length" class="hint">No policies yet.</p>
    <div v-for="(g, idx) in playbook.guidelines.value" :key="g.id" class="item-row">
      <ItemToolbar
        :index="idx"
        :total="playbook.guidelines.value.length"
        :label="g.policyId"
        @up="playbook.moveItem('guidelines', g.id, -1)"
        @down="playbook.moveItem('guidelines', g.id, 1)"
        @remove="playbook.removeItem('guidelines', g.id)"
      />
      <div class="grid-2">
        <div class="field">
          <label>Policy ID</label>
          <input v-model="g.policyId" type="text" :placeholder="idPlaceholder" />
        </div>
        <div class="field">
          <label>Shape</label>
          <select :value="shapeOf(g)" @change="g.shape = $event.target.value">
            <option value="text">Plain text</option>
            <option value="structured">Structured (trigger / keywords / action / requirement / format)</option>
            <option value="raw">Raw XML</option>
          </select>
        </div>
      </div>

      <div v-if="shapeOf(g) === 'text'" class="field">
        <label>Text</label>
        <textarea v-model="g.text" rows="2" placeholder="e.g. Ask only questions directly relevant to identifying the issue."></textarea>
      </div>

      <template v-else-if="shapeOf(g) === 'structured'">
        <div class="grid-2">
          <div class="field">
            <label>Trigger <span class="optional">(&lt;TRIGGER&gt;)</span></label>
            <input v-model="g.trigger" type="text" placeholder="e.g. User confirms findings" />
          </div>
          <div class="field">
            <label>Trigger keywords <span class="optional">(&lt;TRIGGER_KEYWORDS&gt;)</span></label>
            <input v-model="g.triggerKeywords" type="text" placeholder="e.g. assistant, agent, cancel, advisor" />
          </div>
        </div>

        <div class="field">
          <label>
            Action <span class="optional">(&lt;ACTION&gt; — plain text, or the steps below; steps win if both are set)</span>
          </label>
          <input v-model="g.action" type="text" placeholder="e.g. You must always invoke ..." :disabled="(g.actionSteps || []).length > 0" />
        </div>
        <div class="steps-box">
          <div v-for="(st, sIdx) in g.actionSteps" :key="st.id" class="step-row">
            <span class="mono item-index">{{ sIdx + 1 }}</span>
            <select v-model="st.kind" class="step-kind">
              <option value="SET_PARAMETER">SET_PARAMETER</option>
              <option value="INVOKE_FLOW">INVOKE_FLOW</option>
            </select>
            <input
              v-model="st.name"
              type="text"
              :placeholder="st.kind === 'INVOKE_FLOW' ? 'Flow name, e.g. Default_Escalation_Triage' : 'Parameter, e.g. param_escalation_reason'"
            />
            <input v-if="st.kind !== 'INVOKE_FLOW'" v-model="st.value" type="text" placeholder="Value, e.g. user_escalation_agent" />
            <span v-else class="hint flow-hint mono">→ ${FLOW:{{ st.name || '…' }}}</span>
            <button type="button" class="btn btn-ghost" @click="playbook.removeActionStep(g.id, st.id)">✕</button>
          </div>
          <div class="step-add">
            <button type="button" class="btn btn-ghost" @click="playbook.addActionStep(g.id, 'SET_PARAMETER')">+ SET_PARAMETER</button>
            <button type="button" class="btn btn-ghost" @click="playbook.addActionStep(g.id, 'INVOKE_FLOW')">+ INVOKE_FLOW</button>
          </div>
        </div>

        <div class="field">
          <label>Requirement <span class="optional">(&lt;REQUIREMENT&gt;)</span></label>
          <textarea v-model="g.requirement" rows="2" placeholder="e.g. Before invoking a playbook or escalating, generate a JSON-style summary."></textarea>
        </div>
        <div class="field">
          <label>Format <span class="optional">(&lt;FORMAT&gt;)</span></label>
          <input v-model="g.format" type="text" class="mono" placeholder='e.g. {"preceding_conversation_summary": "Customer has [Issue Details]"}' />
        </div>
      </template>

      <div v-else class="field">
        <label>
          Raw XML body
          <button type="button" class="btn btn-ghost btn-inline" @click="convertRaw(g)">Convert to structured fields</button>
        </label>
        <textarea v-model="g.rawXml" rows="6" class="mono raw-xml" placeholder="&lt;TRIGGER_KEYWORDS&gt;...&lt;/TRIGGER_KEYWORDS&gt;"></textarea>
      </div>

      <div class="field">
        <label>Comment <span class="optional">(optional — exported as &lt;!-- ... --&gt; above this POLICY)</span></label>
        <input v-model="g.comment" type="text" />
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
