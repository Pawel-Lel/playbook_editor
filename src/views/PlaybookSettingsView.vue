<script setup lang="ts">
// PlaybookSettingsView — the "Playbook Editor" page (/playbook): every
// setting of the active playbook outside its dialog steps. It shows one of
// two layouts depending on the playbook's shape (router/triage or
// diagnostic-flow — see isRoutingPlaybook).
//
// Vue concepts used in this file:
//  - ref() / computed(): reactive values (see FlowMapView.vue for details).
//  - v-model on store data: inputs below write straight into the active
//    playbook through the store, so there's no Save button — every
//    keystroke is saved (playbooks.js stores it in localStorage).
//  - Child components (GuidelinesEditor, ItemToolbar, ...) receive data via
//    props (:index="...") and report clicks via events (@up="...").
//  - Slots: content placed between <EscalationsEditor> and
//    </EscalationsEditor> is shown inside that component, where its
//    <slot /> tag is.
import { ref, computed } from 'vue'
import { usePlaybookStore } from '../store/playbook'
import { useStepsStore } from '../store/steps'
import { usePlaybooksStore } from '../store/playbooks'
import { buildLlmInstructionsXml, exportFileName } from '../utils/xmlExport'
import ExportXmlModal from '../components/ExportXmlModal.vue'
import ImportXmlModal from '../components/ImportXmlModal.vue'
import GuidelinesEditor from '../components/GuidelinesEditor.vue'
import EscalationsEditor from '../components/EscalationsEditor.vue'
import DocumentLayoutEditor from '../components/DocumentLayoutEditor.vue'
import ItemToolbar from '../components/ItemToolbar.vue'
import type { GlobalReprompt } from '../types'

/** One of the two reprompt editor columns (see `reprompts` below). */
interface RepromptColumn {
  key: 'noMatch' | 'noInput'
  label: string
  tag: string
  data: GlobalReprompt
}

const playbookStore = usePlaybookStore()
const stepsStore = useStepsStore()
const playbooksStore = usePlaybooksStore()
const isExportModalOpen = ref(false)
const isImportModalOpen = ref(false)
const importError = ref('')

// A router/triage-style playbook routes to other playbooks by category
// instead of asking its own diagnostic questions, so it has no dialog steps
// of its own — same detection FlowMapView uses to switch its graph.
const isRoutingPlaybook = computed(
  () => stepsStore.steps.value.length === 0 && playbookStore.routingCategories.value.length > 0
)

const exportedXml = computed(() => buildLlmInstructionsXml(playbookStore.toExportPayload(), stepsStore.steps.value))

// The two playbook-level reprompts share one editor block (rendered with
// v-for below). `data` is the actual reprompt object in the store, so
// v-model on its fields edits the playbook directly.
const reprompts = computed<RepromptColumn[]>(() => [
  { key: 'noMatch', label: 'No-match', tag: 'NO_MATCH', data: playbookStore.globalNoMatch.value },
  { key: 'noInput', label: 'No-input', tag: 'NO_INPUT', data: playbookStore.globalNoInput.value }
])
const DEFAULT_REPROMPT_COMMENTS = {
  noMatch: "Reprompt for when the user's input is not understood (No Match)",
  noInput: 'Reprompt for when the user provides no input (No Input)'
}
// The reprompt's own comment, or the default one if it has never been set.
function repromptComment(reprompt: RepromptColumn): string {
  return reprompt.data.comment === undefined || reprompt.data.comment === null
    ? DEFAULT_REPROMPT_COMMENTS[reprompt.key]
    : reprompt.data.comment
}

function clearPlaybookSettings(): void {
  if (confirm("Clear this playbook's settings? This cannot be undone.")) {
    playbookStore.clearSettings()
  }
}

function openImportModal(): void {
  importError.value = ''
  isImportModalOpen.value = true
}

// Called when ImportXmlModal emits 'imported' with the XML text.
function handleImportedXml(xmlText: string): void {
  try {
    playbooksStore.replaceActivePlaybookFromXml(xmlText)
    isImportModalOpen.value = false
  } catch (error) {
    importError.value = error.message
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
        <button class="btn btn-secondary" @click="openImportModal">Import XML…</button>
        <button class="btn btn-secondary" @click="isExportModalOpen = true">Export XML</button>
      </div>
    </div>

    <section class="panel form-section">
      <h3>Playbook</h3>
      <div class="field">
        <label for="playbookName">Playbook name</label>
        <input id="playbookName" v-model="playbookStore.playbookName.value" type="text" placeholder="e.g. Heating and Hot Water" />
        <p class="hint">Maps to &lt;PARAMETER_ASSIGNMENT name="param_playbook_name" value="…" /&gt; in SETUP.</p>
      </div>
    </section>

    <!-- ================= ROUTER / TRIAGE LAYOUT ================= -->
    <template v-if="isRoutingPlaybook">
      <section class="panel form-section">
        <h3>Setup &middot; role &amp; objective</h3>
        <div class="field">
          <label for="role">Role</label>
          <input id="role" v-model="playbookStore.setup.value.role" type="text" placeholder="e.g. Triage Engineer" />
        </div>
        <div class="field">
          <label for="objective">Objective</label>
          <textarea
            id="objective"
            v-model="playbookStore.setup.value.objective"
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
          <div v-for="reprompt in reprompts" :key="reprompt.key" class="reprompt-col">
            <p class="mono reprompt-tag">&lt;{{ reprompt.tag }}&gt;</p>
            <div class="field">
              <label>Comment <span class="optional">(above &lt;{{ reprompt.tag }}&gt;)</span></label>
              <!-- Not v-model: the box shows the default comment until one is typed,
                   so it reads through repromptComment() and writes on each keystroke
                   ($event is the browser's input event). -->
              <input :value="repromptComment(reprompt)" type="text" @input="reprompt.data.comment = ($event.target as HTMLInputElement).value" />
            </div>
            <div class="field">
              <label>{{ reprompt.label }} prompt</label>
              <textarea v-model="reprompt.data.prompt" rows="3" placeholder="Sorry, I didn't catch a response there, ..."></textarea>
            </div>
            <div class="grid-2">
              <div class="field">
                <label>Tool type</label>
                <input v-model="reprompt.data.action.toolType" type="text" placeholder="e.g. Tool_Invocation" />
              </div>
              <div class="field">
                <label>Tool ID <span class="optional">(opt.)</span></label>
                <input v-model="reprompt.data.action.toolId" type="text" placeholder="e.g. external_memory_redis" />
              </div>
            </div>
            <div class="grid-2">
              <div class="field">
                <label>Parameter name <span class="optional">(opt.)</span></label>
                <input v-model="reprompt.data.action.parameterName" type="text" placeholder="e.g. session_id" />
              </div>
              <div class="field">
                <label>Parameter value <span class="optional">(opt.)</span></label>
                <input v-model="reprompt.data.action.parameterValue" type="text" placeholder="e.g. state[&quot;$session_id&quot;]" />
              </div>
            </div>
            <div v-if="reprompt.data.action.toolType === 'Flow_Invocation'" class="field">
              <label>Flow ID</label>
              <input v-model="reprompt.data.action.flowId" type="text" placeholder="e.g. Default_Escalation_Triage" />
            </div>
          </div>
        </div>
      </EscalationsEditor>

      <section class="panel form-section">
        <div class="section-header">
          <h3>Clarification rules <span class="count mono">{{ playbookStore.clarificationRules.value.length }}</span></h3>
          <button type="button" class="btn btn-secondary" @click="playbookStore.addItem('clarificationRules', { attrName: 'keyword' })">+ Add rule</button>
        </div>
        <div class="field">
          <label>Shared condition <span class="optional">(the &lt;CLARIFICATION_RULES condition="..."&gt; wrapper's own attribute)</span></label>
          <input
            v-model="playbookStore.clarificationRulesCondition.value"
            type="text"
            placeholder="e.g. user_response_is_unclear OR lacks_specific_details"
          />
        </div>
        <div v-for="(rule, ruleIndex) in playbookStore.clarificationRules.value" :key="rule.id" class="item-row">
          <ItemToolbar
            :index="ruleIndex"
            :total="playbookStore.clarificationRules.value.length"
            :label="rule.condition"
            @up="playbookStore.moveItem('clarificationRules', rule.id, -1)"
            @down="playbookStore.moveItem('clarificationRules', rule.id, 1)"
            @remove="playbookStore.removeItem('clarificationRules', rule.id)"
          />
          <div class="grid-rule">
            <div class="field">
              <label>Match on</label>
              <select v-model="rule.attrName">
                <option value="keyword">keyword</option>
                <option value="condition">condition</option>
              </select>
            </div>
            <div class="field">
              <label>Value</label>
              <input v-model="rule.condition" type="text" placeholder="e.g. Shower, shower issue" />
            </div>
          </div>
          <div class="field">
            <label>Prompt</label>
            <textarea v-model="rule.prompt" rows="2" placeholder="Clarification prompt text"></textarea>
          </div>
          <div class="field">
            <label>Routing instruction <span class="optional">(optional &lt;INSTRUCTION&gt; — e.g. "if unsure, route to the Generic Leaks playbook")</span></label>
            <textarea v-model="rule.instruction" rows="2" placeholder="Extra handling guidance for this rule, beyond just the prompt"></textarea>
          </div>
          <div class="field">
            <label>Comment <span class="optional">(optional — exported as &lt;!-- ... --&gt; above this RULE)</span></label>
            <input v-model="rule.comment" type="text" />
          </div>
        </div>
      </section>

      <section class="panel form-section">
        <div class="section-header">
          <h3>Routing logic <span class="count mono">{{ playbookStore.routingCategories.value.length }}</span></h3>
          <button type="button" class="btn btn-secondary" @click="playbookStore.addItem('routingCategories')">+ Add category</button>
        </div>
        <div v-for="(category, categoryIndex) in playbookStore.routingCategories.value" :key="category.id" class="item-row">
          <ItemToolbar
            :index="categoryIndex"
            :total="playbookStore.routingCategories.value.length"
            :label="category.name"
            @up="playbookStore.moveItem('routingCategories', category.id, -1)"
            @down="playbookStore.moveItem('routingCategories', category.id, 1)"
            @remove="playbookStore.removeItem('routingCategories', category.id)"
          />
          <div class="field">
            <label>Category name</label>
            <input v-model="category.name" type="text" placeholder="e.g. Shower Issues (Non-Blockage)" />
          </div>
          <div class="field">
            <label>Trigger phrases</label>
            <textarea v-model="category.triggers" rows="3" placeholder="Comma-separated phrases that route to this category"></textarea>
          </div>
          <div class="field">
            <label>Action</label>
            <input v-model="category.action" type="text" placeholder="e.g. Route to ${PLAYBOOK:Shower Issues}" />
          </div>
          <div class="field">
            <label>Comment <span class="optional">(optional — exported as &lt;!-- ... --&gt; above this CATEGORY)</span></label>
            <input v-model="category.comment" type="text" />
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
            v-model="playbookStore.setup.value.contextInstruction"
            rows="3"
            placeholder="How to use the parent playbook / preceding conversation summary"
          ></textarea>
        </div>
        <div class="field">
          <label for="ctxConstraint">Constraint</label>
          <textarea
            id="ctxConstraint"
            v-model="playbookStore.setup.value.contextConstraint"
            rows="2"
            placeholder="e.g. Avoid redundancy..."
          ></textarea>
        </div>
      </section>

      <GuidelinesEditor id-placeholder="e.g. TONE" />

      <section class="panel form-section">
        <div class="section-header">
          <h3>Dialog constraints</h3>
          <button type="button" class="btn btn-secondary" @click="playbookStore.addItem('dialogConstraints')">+ Add constraint</button>
        </div>
        <div v-for="(constraint, constraintIndex) in playbookStore.dialogConstraints.value" :key="constraint.id" class="item-row">
          <ItemToolbar
            :index="constraintIndex"
            :total="playbookStore.dialogConstraints.value.length"
            :label="constraint.type"
            @up="playbookStore.moveItem('dialogConstraints', constraint.id, -1)"
            @down="playbookStore.moveItem('dialogConstraints', constraint.id, 1)"
            @remove="playbookStore.removeItem('dialogConstraints', constraint.id)"
          />
          <div class="field">
            <label>Type</label>
            <input v-model="constraint.type" type="text" placeholder="e.g. SingleQuestion" />
          </div>
          <div class="field">
            <label>Text <span class="optional">(for a simple constraint)</span></label>
            <textarea v-model="constraint.text" rows="2" placeholder="e.g. You can only ask one question at a time."></textarea>
          </div>
          <div class="grid-2">
            <div class="field">
              <label>Critical <span class="optional">(for a critical/action constraint)</span></label>
              <input v-model="constraint.critical" type="text" placeholder="e.g. Do not invent questions." />
            </div>
            <div class="field">
              <label>Action</label>
              <input v-model="constraint.action" type="text" placeholder="e.g. Vague inputs must be handled by..." />
            </div>
          </div>
        </div>
      </section>

      <section class="panel form-section">
        <div class="section-header">
          <h3>Clarification rules</h3>
          <button type="button" class="btn btn-secondary" @click="playbookStore.addItem('clarificationRules')">+ Add rule</button>
        </div>
        <div v-for="(rule, ruleIndex) in playbookStore.clarificationRules.value" :key="rule.id" class="item-row">
          <ItemToolbar
            :index="ruleIndex"
            :total="playbookStore.clarificationRules.value.length"
            @up="playbookStore.moveItem('clarificationRules', rule.id, -1)"
            @down="playbookStore.moveItem('clarificationRules', rule.id, 1)"
            @remove="playbookStore.removeItem('clarificationRules', rule.id)"
          />
          <div class="grid-2">
            <div class="field">
              <label>Condition <span class="optional">(optional)</span></label>
              <input v-model="rule.condition" type="text" placeholder="Condition this rule applies under" />
            </div>
            <div class="field">
              <label>Prompt</label>
              <input v-model="rule.prompt" type="text" placeholder="Clarification prompt text" />
            </div>
          </div>
        </div>
      </section>

      <EscalationsEditor />
    </template>

    <DocumentLayoutEditor />
  </div>

  <ExportXmlModal
    v-if="isExportModalOpen"
    :xml="exportedXml"
    :filename="exportFileName(playbookStore.playbookName.value)"
    @close="isExportModalOpen = false"
  />
  <ImportXmlModal
    v-if="isImportModalOpen"
    :active-playbook-name="playbookStore.playbookName.value"
    :error-message="importError"
    @close="isImportModalOpen = false"
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
