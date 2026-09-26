<script setup>
import { ref, computed } from 'vue'
import { usePlaybookStore } from '../store/playbook.js'
import { useStepsStore } from '../store/steps.js'
import { usePlaybooksStore } from '../store/playbooks.js'
import { buildLlmInstructionsXml, exportFileName } from '../utils/xmlExport.js'
import ExportXmlModal from '../components/ExportXmlModal.vue'
import ImportXmlModal from '../components/ImportXmlModal.vue'
import GuidelinesEditor from '../components/GuidelinesEditor.vue'
import EscalationsEditor from '../components/EscalationsEditor.vue'
import DocumentLayoutEditor from '../components/DocumentLayoutEditor.vue'
import ItemToolbar from '../components/ItemToolbar.vue'

const playbook = usePlaybookStore()
const stepsStore = useStepsStore()
const playbooksStore = usePlaybooksStore()
const showExport = ref(false)
const showImport = ref(false)
const importError = ref('')

// A router/triage-style playbook routes to other playbooks by category
// instead of asking its own diagnostic questions, so it has no dialog steps
// of its own — same detection FlowMapView uses to switch its graph.
const isRoutingPlaybook = computed(
  () => stepsStore.steps.value.length === 0 && playbook.routingCategories.value.length > 0
)

const exportedXml = computed(() => buildLlmInstructionsXml(playbook.toExportPayload(), stepsStore.steps.value))

// The two playbook-level reprompts share one editor block.
const reprompts = computed(() => [
  { key: 'noMatch', label: 'No-match', tag: 'NO_MATCH', data: playbook.globalNoMatch.value },
  { key: 'noInput', label: 'No-input', tag: 'NO_INPUT', data: playbook.globalNoInput.value }
])
const DEFAULT_REPROMPT_COMMENTS = {
  noMatch: "Reprompt for when the user's input is not understood (No Match)",
  noInput: 'Reprompt for when the user provides no input (No Input)'
}
function repromptComment(r) {
  return r.data.comment === undefined || r.data.comment === null ? DEFAULT_REPROMPT_COMMENTS[r.key] : r.data.comment
}

function clearPlaybookSettings() {
  if (confirm("Clear this playbook's settings? This cannot be undone.")) {
    playbook.clearSettings()
  }
}

function openImport() {
  importError.value = ''
  showImport.value = true
}

function handleImportedXml(xmlText) {
  try {
    playbooksStore.replaceActivePlaybookFromXml(xmlText)
    showImport.value = false
  } catch (e) {
    importError.value = e.message
  }
}
</script>

<template>
  <div class="container container--narrow">
    <div class="page-head">
      <div>
        <p class="eyebrow mono">{{ isRoutingPlaybook ? 'Router / triage playbook' : 'Diagnostic-flow playbook' }}</p>
        <h1>{{ isRoutingPlaybook ? 'Triage settings' : 'Playbook settings' }}</h1>
        <p class="page-sub">
          <template v-if="isRoutingPlaybook">
            Routes the caller to another playbook by category instead of asking its own diagnostic
            questions: setup, guidelines, escalation handling, clarification rules, and routing logic.
          </template>
          <template v-else>
            Everything in the source XML outside individual dialog steps: setup, behavioural
            guidelines, dialog constraints, clarification rules and escalation triggers.
          </template>
          Changes save automatically.
        </p>
      </div>
      <div class="page-head__actions">
        <button class="btn btn-secondary" @click="clearPlaybookSettings">Clear settings</button>
        <button class="btn btn-secondary" @click="openImport">Import XML…</button>
        <button class="btn btn-secondary" @click="showExport = true">Export XML</button>
      </div>
    </div>

    <section class="panel form-section">
      <h3>Playbook</h3>
      <div class="field">
        <label for="playbookName">Playbook name</label>
        <input id="playbookName" v-model="playbook.playbookName.value" type="text" placeholder="e.g. Heating and Hot Water" />
        <p class="hint">Maps to &lt;PARAMETER_ASSIGNMENT name="param_playbook_name" value="…" /&gt; in SETUP.</p>
      </div>
    </section>

    <!-- ================= ROUTER / TRIAGE LAYOUT ================= -->
    <template v-if="isRoutingPlaybook">
      <section class="panel form-section">
        <h3>Setup &middot; role &amp; objective</h3>
        <div class="field">
          <label for="role">Role</label>
          <input id="role" v-model="playbook.setup.value.role" type="text" placeholder="e.g. Triage Engineer" />
        </div>
        <div class="field">
          <label for="objective">Objective</label>
          <textarea
            id="objective"
            v-model="playbook.setup.value.objective"
            rows="4"
            placeholder="What this playbook is trying to accomplish, and when to escalate instead of guessing"
          ></textarea>
        </div>
      </section>

      <GuidelinesEditor id-placeholder="e.g. FOCUS" />

      <EscalationsEditor>
        <h4 class="subsection-heading">
          No-match / no-input reprompts &middot; &lt;EVENT_HANDLERS&gt;
          <span class="optional">(playbook-level, instead of per-step — shown to the caller once before escalating)</span>
        </h4>
        <div class="grid-2">
          <div v-for="r in reprompts" :key="r.key" class="reprompt-col">
            <p class="mono reprompt-tag">&lt;{{ r.tag }}&gt;</p>
            <div class="field">
              <label>Comment <span class="optional">(above &lt;{{ r.tag }}&gt;)</span></label>
              <input :value="repromptComment(r)" type="text" @input="r.data.comment = $event.target.value" />
            </div>
            <div class="field">
              <label>{{ r.label }} prompt</label>
              <textarea v-model="r.data.prompt" rows="3" placeholder="Sorry, I didn't catch a response there, ..."></textarea>
            </div>
            <div class="grid-2">
              <div class="field">
                <label>Tool type</label>
                <input v-model="r.data.action.toolType" type="text" placeholder="e.g. Tool_Invocation" />
              </div>
              <div class="field">
                <label>Tool ID <span class="optional">(opt.)</span></label>
                <input v-model="r.data.action.toolId" type="text" placeholder="e.g. external_memory_redis" />
              </div>
            </div>
            <div class="grid-2">
              <div class="field">
                <label>Parameter name <span class="optional">(opt.)</span></label>
                <input v-model="r.data.action.parameterName" type="text" placeholder="e.g. session_id" />
              </div>
              <div class="field">
                <label>Parameter value <span class="optional">(opt.)</span></label>
                <input v-model="r.data.action.parameterValue" type="text" placeholder="e.g. state[&quot;$session_id&quot;]" />
              </div>
            </div>
            <div v-if="r.data.action.toolType === 'Flow_Invocation'" class="field">
              <label>Flow ID</label>
              <input v-model="r.data.action.flowId" type="text" placeholder="e.g. Default_Escalation_Triage" />
            </div>
          </div>
        </div>
      </EscalationsEditor>

      <section class="panel form-section">
        <div class="section-header">
          <h3>Clarification rules <span class="count mono">{{ playbook.clarificationRules.value.length }}</span></h3>
          <button type="button" class="btn btn-secondary" @click="playbook.addItem('clarificationRules', { attrName: 'keyword' })">+ Add rule</button>
        </div>
        <div class="field">
          <label>Shared condition <span class="optional">(the &lt;CLARIFICATION_RULES condition="..."&gt; wrapper's own attribute)</span></label>
          <input
            v-model="playbook.clarificationRulesCondition.value"
            type="text"
            placeholder="e.g. user_response_is_unclear OR lacks_specific_details"
          />
        </div>
        <div v-for="(r, idx) in playbook.clarificationRules.value" :key="r.id" class="item-row">
          <ItemToolbar
            :index="idx"
            :total="playbook.clarificationRules.value.length"
            :label="r.condition"
            @up="playbook.moveItem('clarificationRules', r.id, -1)"
            @down="playbook.moveItem('clarificationRules', r.id, 1)"
            @remove="playbook.removeItem('clarificationRules', r.id)"
          />
          <div class="grid-rule">
            <div class="field">
              <label>Match on</label>
              <select v-model="r.attrName">
                <option value="keyword">keyword</option>
                <option value="condition">condition</option>
              </select>
            </div>
            <div class="field">
              <label>Value</label>
              <input v-model="r.condition" type="text" placeholder="e.g. Shower, shower issue" />
            </div>
          </div>
          <div class="field">
            <label>Prompt</label>
            <textarea v-model="r.prompt" rows="2" placeholder="Clarification prompt text"></textarea>
          </div>
          <div class="field">
            <label>Routing instruction <span class="optional">(optional &lt;INSTRUCTION&gt; — e.g. "if unsure, route to the Generic Leaks playbook")</span></label>
            <textarea v-model="r.instruction" rows="2" placeholder="Extra handling guidance for this rule, beyond just the prompt"></textarea>
          </div>
          <div class="field">
            <label>Comment <span class="optional">(optional — exported as &lt;!-- ... --&gt; above this RULE)</span></label>
            <input v-model="r.comment" type="text" />
          </div>
        </div>
      </section>

      <section class="panel form-section">
        <div class="section-header">
          <h3>Routing logic <span class="count mono">{{ playbook.routingCategories.value.length }}</span></h3>
          <button type="button" class="btn btn-secondary" @click="playbook.addItem('routingCategories')">+ Add category</button>
        </div>
        <div v-for="(c, idx) in playbook.routingCategories.value" :key="c.id" class="item-row">
          <ItemToolbar
            :index="idx"
            :total="playbook.routingCategories.value.length"
            :label="c.name"
            @up="playbook.moveItem('routingCategories', c.id, -1)"
            @down="playbook.moveItem('routingCategories', c.id, 1)"
            @remove="playbook.removeItem('routingCategories', c.id)"
          />
          <div class="field">
            <label>Category name</label>
            <input v-model="c.name" type="text" placeholder="e.g. Shower Issues (Non-Blockage)" />
          </div>
          <div class="field">
            <label>Trigger phrases</label>
            <textarea v-model="c.triggers" rows="3" placeholder="Comma-separated phrases that route to this category"></textarea>
          </div>
          <div class="field">
            <label>Action</label>
            <input v-model="c.action" type="text" placeholder="e.g. Route to ${PLAYBOOK:Shower Issues}" />
          </div>
          <div class="field">
            <label>Comment <span class="optional">(optional — exported as &lt;!-- ... --&gt; above this CATEGORY)</span></label>
            <input v-model="c.comment" type="text" />
          </div>
        </div>
      </section>
    </template>

    <!-- ================= DIAGNOSTIC-FLOW LAYOUT ================= -->
    <template v-else>
      <section class="panel form-section">
        <h3>Setup &middot; context handling</h3>
        <div class="field">
          <label for="ctxInstruction">Instruction</label>
          <textarea
            id="ctxInstruction"
            v-model="playbook.setup.value.contextInstruction"
            rows="3"
            placeholder="How to use the parent playbook / preceding conversation summary"
          ></textarea>
        </div>
        <div class="field">
          <label for="ctxConstraint">Constraint</label>
          <textarea
            id="ctxConstraint"
            v-model="playbook.setup.value.contextConstraint"
            rows="2"
            placeholder="e.g. Avoid redundancy..."
          ></textarea>
        </div>
      </section>

      <GuidelinesEditor id-placeholder="e.g. TONE" />

      <section class="panel form-section">
        <div class="section-header">
          <h3>Dialog constraints</h3>
          <button type="button" class="btn btn-secondary" @click="playbook.addItem('dialogConstraints')">+ Add constraint</button>
        </div>
        <div v-for="(c, idx) in playbook.dialogConstraints.value" :key="c.id" class="item-row">
          <ItemToolbar
            :index="idx"
            :total="playbook.dialogConstraints.value.length"
            :label="c.type"
            @up="playbook.moveItem('dialogConstraints', c.id, -1)"
            @down="playbook.moveItem('dialogConstraints', c.id, 1)"
            @remove="playbook.removeItem('dialogConstraints', c.id)"
          />
          <div class="field">
            <label>Type</label>
            <input v-model="c.type" type="text" placeholder="e.g. SingleQuestion" />
          </div>
          <div class="field">
            <label>Text <span class="optional">(for a simple constraint)</span></label>
            <textarea v-model="c.text" rows="2" placeholder="e.g. You can only ask one question at a time."></textarea>
          </div>
          <div class="grid-2">
            <div class="field">
              <label>Critical <span class="optional">(for a critical/action constraint)</span></label>
              <input v-model="c.critical" type="text" placeholder="e.g. Do not invent questions." />
            </div>
            <div class="field">
              <label>Action</label>
              <input v-model="c.action" type="text" placeholder="e.g. Vague inputs must be handled by..." />
            </div>
          </div>
        </div>
      </section>

      <section class="panel form-section">
        <div class="section-header">
          <h3>Clarification rules</h3>
          <button type="button" class="btn btn-secondary" @click="playbook.addItem('clarificationRules')">+ Add rule</button>
        </div>
        <div v-for="(r, idx) in playbook.clarificationRules.value" :key="r.id" class="item-row">
          <ItemToolbar
            :index="idx"
            :total="playbook.clarificationRules.value.length"
            @up="playbook.moveItem('clarificationRules', r.id, -1)"
            @down="playbook.moveItem('clarificationRules', r.id, 1)"
            @remove="playbook.removeItem('clarificationRules', r.id)"
          />
          <div class="grid-2">
            <div class="field">
              <label>Condition <span class="optional">(optional)</span></label>
              <input v-model="r.condition" type="text" placeholder="Condition this rule applies under" />
            </div>
            <div class="field">
              <label>Prompt</label>
              <input v-model="r.prompt" type="text" placeholder="Clarification prompt text" />
            </div>
          </div>
        </div>
      </section>

      <EscalationsEditor />
    </template>

    <DocumentLayoutEditor />
  </div>

  <ExportXmlModal
    v-if="showExport"
    :xml="exportedXml"
    :filename="exportFileName(playbook.playbookName.value)"
    @close="showExport = false"
  />
  <ImportXmlModal
    v-if="showImport"
    mode="replace"
    :active-playbook-name="playbook.playbookName.value"
    :error-message="importError"
    @close="showImport = false"
    @imported="handleImportedXml"
  />
</template>

<style scoped>
.container--narrow {
  max-width: 900px;
}
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 1.5rem;
  gap: 1rem;
  flex-wrap: wrap;
}
.page-sub {
  color: var(--slate-500);
  font-size: 0.86rem;
  max-width: 62ch;
  margin: 0;
}
.page-head__actions {
  display: flex;
  gap: 0.6rem;
  flex-shrink: 0;
  flex-wrap: wrap;
}
h1 { margin: 0 0 0.25em; }
.eyebrow {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--brand-dark);
  margin: 0 0 0.3em;
}
.reprompt-col {
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 0.9rem 1rem 0.1rem;
  background: #f8f9fa;
}
.reprompt-tag {
  font-size: 0.75rem;
  color: var(--brand-dark);
  margin: 0 0 0.6rem;
}
.grid-rule {
  display: grid;
  grid-template-columns: 10rem 1fr;
  gap: 1rem 1.25rem;
}
@media (max-width: 720px) {
  .grid-rule { grid-template-columns: 1fr; }
}
</style>
