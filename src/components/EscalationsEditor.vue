<script setup lang="ts">
// CRUD for <ESCALATION_HANDLING><ESCALATION> entries, shared by both
// Playbook Settings layouts. Every part of the exported element is
// editable: the condition/type attribute, the comment above it (e.g.
// "Gas Emergency"), DESCRIPTION, TRIGGER, the create_json_data_object's
// param_escalation_reason and param_playbook_name, the "Note:" comment and
// the INVOKE_FLOW target. The slot renders below the list (Triage uses it
// for the EVENT_HANDLERS reprompts, which live in the same XML section).
import { usePlaybookStore } from '../store/playbook'
import ItemToolbar from './ItemToolbar.vue'

const playbookStore = usePlaybookStore()
</script>

<template>
  <section class="panel form-section">
    <div class="section-header">
      <h3>Escalation handling <span class="count mono">{{ playbookStore.escalations.value.length }}</span></h3>
      <button type="button" class="btn btn-secondary" @click="playbookStore.addItem('escalations')">+ Add escalation</button>
    </div>
    <p v-if="!playbookStore.escalations.value.length" class="hint">No escalations yet.</p>
    <div v-for="(escalation, escalationIndex) in playbookStore.escalations.value" :key="escalation.id" class="item-row">
      <ItemToolbar
        :index="escalationIndex"
        :total="playbookStore.escalations.value.length"
        :label="escalation.condition"
        @up="playbookStore.moveItem('escalations', escalation.id, -1)"
        @down="playbookStore.moveItem('escalations', escalation.id, 1)"
        @remove="playbookStore.removeItem('escalations', escalation.id)"
      />
      <div class="field">
        <label>Comment <span class="optional">(optional — exported as &lt;!-- ... --&gt; above this ESCALATION, e.g. "Gas Emergency")</span></label>
        <input v-model="escalation.comment" type="text" />
      </div>
      <div class="grid-3">
        <div class="field">
          <label>Attribute</label>
          <select v-model="escalation.attrName">
            <option value="condition">condition</option>
            <option value="type">type</option>
          </select>
        </div>
        <div class="field">
          <label>Value</label>
          <input v-model="escalation.condition" type="text" placeholder="e.g. GAS_LEAK" />
        </div>
        <div class="field">
          <label>Escalation reason</label>
          <input v-model="escalation.escalationReason" type="text" placeholder="e.g. gas_emergency" />
        </div>
      </div>
      <div class="field">
        <label>Description <span class="optional">(optional)</span></label>
        <textarea v-model="escalation.description" rows="2" placeholder="What indicates this escalation"></textarea>
      </div>
      <div class="field">
        <label>Trigger phrases</label>
        <textarea v-model="escalation.trigger" rows="2" placeholder="e.g. leaking gas, gas leak"></textarea>
      </div>
      <div class="grid-2">
        <div class="field">
          <label>Flow to invoke</label>
          <input v-model="escalation.flowName" type="text" placeholder="e.g. Emergency_Escalation_Gas" />
        </div>
        <div class="field">
          <label>param_playbook_name <span class="optional">(blank = this playbook's name)</span></label>
          <input v-model="escalation.playbookNameParam" type="text" :placeholder="playbookStore.playbookName.value" />
        </div>
      </div>
      <div class="field">
        <label>Note <span class="optional">(optional, exported as &lt;!-- Note: ... --&gt; inside ACTION)</span></label>
        <textarea v-model="escalation.note" rows="2" placeholder="Context for why this escalates"></textarea>
      </div>
    </div>
    <!-- <slot />: whatever the parent puts between <EscalationsEditor> tags appears here. -->
    <slot />
  </section>
</template>
