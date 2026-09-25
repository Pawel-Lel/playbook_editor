<script setup>
import { computed, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useStepsStore } from '../store/steps.js'
import { usePlaybookStore } from '../store/playbook.js'
import { usePlaybooksStore } from '../store/playbooks.js'
import { buildLlmInstructionsXml, exportFileName } from '../utils/xmlExport.js'
import ExportXmlModal from '../components/ExportXmlModal.vue'

const router = useRouter()
const store = useStepsStore()
const playbook = usePlaybookStore()
const playbooksStore = usePlaybooksStore()
const showExport = ref(false)
const exportedXml = computed(() =>
  buildLlmInstructionsXml(
    playbook.toExportPayload(),
    store.steps.value
  )
)

const NODE_W = 216
const NODE_H = 78
const COL_GAP = 130
const ROW_GAP = 34

const selectedId = ref(null)
const zoom = ref(1)

// A router/triage-style playbook has routing categories instead of dialog
// steps — it gets a different graph (this playbook → category → target
// playbook) rather than the step-classification flow below.
const isRoutingPlaybook = computed(() => store.steps.value.length === 0 && playbook.routingCategories.value.length > 0)

// ---- Build the step-flow graph ---------------------------------------

const stepNodesById = computed(() => {
  const map = new Map()
  store.allReferencedTargets.value.forEach((t) => map.set(t.id, t))
  return map
})

const stepEdges = computed(() => {
  const list = []
  store.steps.value.forEach((s) => {
    s.classifications.forEach((c) => {
      if (!c.nextStep) return
      list.push({
        id: c.id,
        from: s.id,
        to: c.nextStep,
        label: c.classificationId || c.triggerCondition || '',
        isEscalation:
          (c.actions || []).some((a) => a.toolType === 'Flow_Invocation') ||
          /do.?not.?know/i.test(c.triggerCondition || '')
      })
    })
  })
  return list
})

// ---- Build the routing graph -------------------------------------------

function extractPlaybookTarget(action) {
  const m = String(action || '').match(/\$\{PLAYBOOK:([^}]+)\}/)
  return m ? m[1].trim() : ''
}

function findTargetPlaybook(name) {
  const needle = name.trim().toLowerCase()
  return playbooksStore.playbooks.value.find((p) => (p.playbookName || '').trim().toLowerCase() === needle) || null
}

const ROOT_ID = '__playbook_root__'

const routingNodesById = computed(() => {
  const map = new Map()
  map.set(ROOT_ID, {
    id: ROOT_ID,
    displayId: playbook.playbookName.value || 'This playbook',
    kind: 'root',
    label: 'Triage entry point'
  })
  playbook.routingCategories.value.forEach((c) => {
    const catId = `cat:${c.id}`
    const targetName = extractPlaybookTarget(c.action)
    map.set(catId, {
      id: catId,
      displayId: c.name || '(unnamed category)',
      kind: 'category',
      label: targetName ? `→ ${targetName}` : c.action || '(no routing action set)'
    })
    if (!targetName) return
    const targetPlaybook = findTargetPlaybook(targetName)
    const targetId = targetPlaybook ? `playbook:${targetPlaybook.id}` : `unknown-playbook:${targetName}`
    if (!map.has(targetId)) {
      map.set(targetId, {
        id: targetId,
        displayId: targetPlaybook ? targetPlaybook.playbookName : targetName,
        kind: targetPlaybook ? 'playbook' : 'unknown-playbook',
        label: targetPlaybook ? 'In this workspace — double-click to switch' : 'Not found in this workspace',
        targetPlaybookId: targetPlaybook ? targetPlaybook.id : null
      })
    }
  })
  return map
})

const routingEdges = computed(() => {
  const list = []
  playbook.routingCategories.value.forEach((c) => {
    const catId = `cat:${c.id}`
    list.push({ id: `e-root-${c.id}`, from: ROOT_ID, to: catId, label: '', isEscalation: false })
    const targetName = extractPlaybookTarget(c.action)
    if (!targetName) return
    const targetPlaybook = findTargetPlaybook(targetName)
    const targetId = targetPlaybook ? `playbook:${targetPlaybook.id}` : `unknown-playbook:${targetName}`
    list.push({ id: `e-cat-${c.id}`, from: catId, to: targetId, label: 'routes to', isEscalation: !targetPlaybook })
  })
  return list
})

function categoryTriggersFor(id) {
  const c = playbook.routingCategories.value.find((cat) => `cat:${cat.id}` === id)
  return c?.triggers || ''
}

// A plain, unambiguous "category → target playbook" list shown alongside
// the graph — guarantees the relationship is readable even before you've
// looked at (or interacted with) the diagram itself.
const routingSummary = computed(() => {
  if (!isRoutingPlaybook.value) return []
  return playbook.routingCategories.value.map((c) => {
    const targetName = extractPlaybookTarget(c.action)
    const targetPlaybook = targetName ? findTargetPlaybook(targetName) : null
    return {
      id: c.id,
      catId: `cat:${c.id}`,
      name: c.name || '(unnamed category)',
      targetName: targetName || '(no routing action set)',
      resolved: !!targetPlaybook,
      targetPlaybookId: targetPlaybook ? targetPlaybook.id : null
    }
  })
})

function switchToPlaybookId(id) {
  playbooksStore.setActivePlaybookId(id)
  selectedId.value = null
}

// ---- Graph the template actually renders (switches on playbook shape) --

const nodesById = computed(() => (isRoutingPlaybook.value ? routingNodesById.value : stepNodesById.value))
const edges = computed(() => (isRoutingPlaybook.value ? routingEdges.value : stepEdges.value))

const pageSubtitle = computed(() => {
  if (isRoutingPlaybook.value) {
    const n = playbook.routingCategories.value.length
    return `${n} routing categor${n === 1 ? 'y' : 'ies'}. Double-click a resolved target playbook to switch to it.`
  }
  return `${nodes.value.length} nodes · ${edges.value.length} classification links. Columns are ordered by ` +
    'distance from the entry steps; click a node to trace its connections.'
})

const svgAriaLabel = computed(() =>
  isRoutingPlaybook.value
    ? 'Diagram of routing categories and the playbooks they route to'
    : 'Diagram of relationships between dialog steps'
)

// Layered (longest-path) layout via topological levelling, robust to cycles.
const layout = computed(() => {
  const ids = Array.from(nodesById.value.keys())
  const outgoing = new Map(ids.map((id) => [id, []]))
  const incoming = new Map(ids.map((id) => [id, []]))
  edges.value.forEach((e) => {
    if (outgoing.has(e.from)) outgoing.get(e.from).push(e.to)
    if (incoming.has(e.to)) incoming.get(e.to).push(e.from)
  })

  const level = new Map()
  const visiting = new Set()

  function levelOf(id) {
    if (level.has(id)) return level.get(id)
    if (visiting.has(id)) return 0 // cycle guard
    visiting.add(id)
    const preds = incoming.get(id) || []
    let lvl = 0
    preds.forEach((p) => {
      lvl = Math.max(lvl, levelOf(p) + 1)
    })
    visiting.delete(id)
    level.set(id, lvl)
    return lvl
  }

  ids.forEach((id) => levelOf(id))

  const columns = new Map()
  ids.forEach((id) => {
    const lvl = level.get(id)
    if (!columns.has(lvl)) columns.set(lvl, [])
    columns.get(lvl).push(id)
  })

  const positions = new Map()
  const maxLevel = Math.max(0, ...Array.from(columns.keys()))
  let maxRows = 0

  for (let lvl = 0; lvl <= maxLevel; lvl++) {
    const col = (columns.get(lvl) || []).sort((a, b) => a.localeCompare(b))
    maxRows = Math.max(maxRows, col.length)
    col.forEach((id, row) => {
      positions.set(id, {
        x: lvl * (NODE_W + COL_GAP) + 24,
        y: row * (NODE_H + ROW_GAP) + 24
      })
    })
  }

  const width = (maxLevel + 1) * (NODE_W + COL_GAP) + 48
  const height = maxRows * (NODE_H + ROW_GAP) + 48

  return { positions, width: Math.max(width, 800), height: Math.max(height, 500) }
})

const nodes = computed(() =>
  Array.from(nodesById.value.values()).map((n) => {
    const pos = layout.value.positions.get(n.id) || { x: 0, y: 0 }
    return { ...n, ...pos }
  })
)

function nodeById(id) {
  return nodes.value.find((n) => n.id === id)
}

function nodeDisplayId(n) {
  const text = n.displayId || n.id
  return text.length > 26 ? text.slice(0, 25) + '…' : text
}

function nodeTooltip(id) {
  if (isRoutingPlaybook.value) {
    return categoryTriggersFor(id)
  }
  return store.getStep(id)?.comment || ''
}

function edgePath(e) {
  const from = nodeById(e.from)
  const to = nodeById(e.to)
  if (!from || !to) return ''
  const sx = from.x + NODE_W
  const sy = from.y + NODE_H / 2
  const tx = to.x
  const ty = to.y + NODE_H / 2
  const dx = Math.max(60, (tx - sx) / 2)
  return `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`
}

function edgeMidpoint(e) {
  const from = nodeById(e.from)
  const to = nodeById(e.to)
  if (!from || !to) return { x: 0, y: 0 }
  return {
    x: (from.x + NODE_W + to.x) / 2,
    y: (from.y + to.y) / 2 + NODE_H / 2
  }
}

const relatedEdgeIds = computed(() => {
  if (!selectedId.value) return new Set()
  return new Set(
    edges.value
      .filter((e) => e.from === selectedId.value || e.to === selectedId.value)
      .map((e) => e.id)
  )
})

function isEdgeDimmed(e) {
  return selectedId.value && !relatedEdgeIds.value.has(e.id)
}
function isNodeDimmed(n) {
  if (!selectedId.value) return false
  if (n.id === selectedId.value) return false
  return !edges.value.some(
    (e) =>
      (e.from === selectedId.value && e.to === n.id) ||
      (e.to === selectedId.value && e.from === n.id)
  )
}

function selectNode(id) {
  selectedId.value = selectedId.value === id ? null : id
}

function goToStep(id) {
  if (nodesById.value.get(id)?.kind === 'step') {
    router.push(`/steps/${encodeURIComponent(id)}`)
  }
}

function switchToTargetPlaybook(id) {
  const node = nodesById.value.get(id)
  if (node?.kind === 'playbook' && node.targetPlaybookId) {
    playbooksStore.setActivePlaybookId(node.targetPlaybookId)
    selectedId.value = null
  }
}

function handleNodeActivate(id) {
  const node = nodesById.value.get(id)
  if (!node) return
  if (node.kind === 'step') {
    goToStep(id)
  } else if (node.kind === 'playbook') {
    switchToTargetPlaybook(id)
  }
}

function badgeClass(kind) {
  return {
    step: 'badge-step',
    terminal: 'badge-terminal',
    flow: 'badge-flow',
    unknown: 'badge-unknown',
    dynamic: 'badge-dynamic',
    root: 'badge-root',
    category: 'badge-category',
    playbook: 'badge-playbook',
    'unknown-playbook': 'badge-unknown'
  }[kind] || 'badge-unknown'
}

function setZoom(val) {
  zoom.value = Math.min(1.4, Math.max(0.4, val))
}
</script>

<template>
  <div class="container container--wide">
    <div class="page-head">
      <div>
        <p class="eyebrow mono">{{ playbook.playbookName.value || '(untitled playbook)' }}</p>
        <h1>Flow map</h1>
        <p class="page-sub">{{ pageSubtitle }}</p>
      </div>
      <RouterLink to="/steps" class="btn btn-secondary">← Back to steps</RouterLink>
    </div>

    <div class="toolbar-row">
      <button class="btn btn-secondary" @click="showExport = true">Export XML</button>
    </div>

    <div class="legend panel">
      <template v-if="isRoutingPlaybook">
        <span class="legend__item"><i class="dot dot-root"></i> This playbook</span>
        <span class="legend__item"><i class="dot dot-category"></i> Routing category</span>
        <span class="legend__item"><i class="dot dot-playbook"></i> Target playbook (double-click to switch)</span>
        <span class="legend__item"><i class="dot dot-unknown"></i> Target not found in this workspace</span>
      </template>
      <template v-else>
        <span class="legend__item"><i class="dot dot-step"></i> Dialog step</span>
        <span class="legend__item"><i class="dot dot-terminal"></i> Terminal / summary</span>
        <span class="legend__item"><i class="dot dot-flow"></i> Flow invocation</span>
        <span class="legend__item"><i class="dot dot-unknown"></i> Unresolved reference</span>
        <span class="legend__item"><i class="dot dot-dynamic"></i> Runtime placeholder</span>
        <span class="legend__item legend__item--edge"><i class="line line-escalation"></i> Escalation / unknown-fuel path</span>
      </template>
      <div class="legend__zoom">
        <button class="btn btn-ghost" @click="setZoom(zoom - 0.15)" aria-label="Zoom out">−</button>
        <span class="mono zoom-value">{{ Math.round(zoom * 100) }}%</span>
        <button class="btn btn-ghost" @click="setZoom(zoom + 0.15)" aria-label="Zoom in">+</button>
      </div>
    </div>

    <div v-if="isRoutingPlaybook" class="routing-summary panel">
      <h3>Category → target playbook</h3>
      <ul class="routing-summary__list">
        <li
          v-for="r in routingSummary"
          :key="r.id"
          class="routing-summary__row"
          :class="{ 'is-selected': selectedId === r.catId }"
          @click="selectNode(r.catId)"
        >
          <span class="routing-summary__category">{{ r.name }}</span>
          <span class="routing-summary__arrow" aria-hidden="true">→</span>
          <span class="routing-summary__target" :class="{ 'is-unresolved': !r.resolved }">
            {{ r.targetName }}
          </span>
          <span class="badge" :class="r.resolved ? 'badge-playbook' : 'badge-unknown'">
            {{ r.resolved ? 'in workspace' : 'not found' }}
          </span>
          <button
            v-if="r.resolved"
            type="button"
            class="btn btn-ghost routing-summary__switch"
            @click.stop="switchToPlaybookId(r.targetPlaybookId)"
          >
            Switch →
          </button>
        </li>
      </ul>
    </div>

    <div class="map-scroll panel">
      <svg
        :viewBox="`0 0 ${layout.width} ${layout.height}`"
        :width="layout.width * zoom"
        :height="layout.height * zoom"
        role="img"
        :aria-label="svgAriaLabel"
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" style="fill: var(--slate-500)" />
          </marker>
          <marker id="arrow-escalation" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" style="fill: var(--amber-dark)" />
          </marker>
        </defs>

        <g class="edges">
          <g
            v-for="e in edges"
            :key="e.id"
            class="edge"
            :class="{ 'is-dimmed': isEdgeDimmed(e), 'is-escalation': e.isEscalation }"
          >
            <path
              :d="edgePath(e)"
              fill="none"
              :style="{ stroke: e.isEscalation ? 'var(--amber-dark)' : 'var(--slate-500)' }"
              stroke-width="1.6"
              :marker-end="e.isEscalation ? 'url(#arrow-escalation)' : 'url(#arrow)'"
            />
            <g v-if="!isEdgeDimmed(e) && e.label" :transform="`translate(${edgeMidpoint(e).x}, ${edgeMidpoint(e).y})`">
              <rect
                x="-3"
                y="-9"
                :width="Math.min(220, (e.label.length * 5.3) + 10)"
                height="16"
                rx="2"
                fill="var(--paper)"
                stroke="var(--line)"
              />
              <text x="1" y="3" class="edge-label mono">{{ e.label.slice(0, 38) }}{{ e.label.length > 38 ? '…' : '' }}</text>
            </g>
          </g>
        </g>

        <g class="nodes">
          <g
            v-for="n in nodes"
            :key="n.id"
            :transform="`translate(${n.x}, ${n.y})`"
            class="node"
            :class="[`node--${n.kind}`, { 'is-selected': selectedId === n.id, 'is-dimmed': isNodeDimmed(n) }]"
            @click="selectNode(n.id)"
            @dblclick="handleNodeActivate(n.id)"
            tabindex="0"
            role="button"
            :aria-label="`${n.displayId || n.id}: ${n.label}`"
          >
            <title v-if="nodeTooltip(n.id)">{{ nodeTooltip(n.id) }}</title>
            <rect :width="NODE_W" :height="NODE_H" rx="5" class="node-rect" />
            <rect :width="4" :height="NODE_H" rx="2" class="node-accent" />
            <text x="14" y="20" class="node-kind mono">{{ n.kind }}</text>
            <text x="14" y="38" class="node-id mono">{{ nodeDisplayId(n) }}</text>
            <foreignObject x="14" y="44" :width="NODE_W - 28" height="30">
              <div xmlns="http://www.w3.org/1999/xhtml" class="node-label">{{ n.label }}</div>
            </foreignObject>
            <circle v-if="nodeTooltip(n.id)" :cx="NODE_W - 12" cy="12" r="4" class="comment-dot" />
          </g>
        </g>
      </svg>
    </div>

    <div v-if="selectedId" class="detail-drawer panel">
      <div class="detail-drawer__head">
        <div>
          <span class="badge" :class="badgeClass(nodesById.get(selectedId)?.kind)">
            {{ nodesById.get(selectedId)?.kind }}
          </span>
          <span class="mono detail-id">{{ nodesById.get(selectedId)?.displayId || selectedId }}</span>
        </div>
        <div class="detail-drawer__actions">
          <RouterLink
            v-if="nodesById.get(selectedId)?.kind === 'step'"
            :to="`/steps/${encodeURIComponent(selectedId)}`"
            class="btn btn-secondary"
          >
            Open step →
          </RouterLink>
          <button
            v-else-if="nodesById.get(selectedId)?.kind === 'playbook'"
            class="btn btn-secondary"
            @click="switchToTargetPlaybook(selectedId)"
          >
            Switch to this playbook →
          </button>
          <button class="btn btn-ghost" @click="selectedId = null">Close</button>
        </div>
      </div>
      <p class="detail-drawer__label">{{ nodesById.get(selectedId)?.label }}</p>
      <p v-if="isRoutingPlaybook && nodesById.get(selectedId)?.kind === 'category'" class="detail-drawer__triggers">
        <strong>Triggers:</strong> {{ categoryTriggersFor(selectedId) }}
      </p>
      <div class="detail-drawer__lists">
        <div>
          <h4>Incoming ({{ edges.filter(e => e.to === selectedId).length }})</h4>
          <ul>
            <li v-for="e in edges.filter(e => e.to === selectedId)" :key="e.id">
              <span class="mono">{{ nodesById.get(e.from)?.displayId || e.from }}</span> — {{ e.label }}
            </li>
            <li v-if="!edges.some(e => e.to === selectedId)" class="muted">None (entry point)</li>
          </ul>
        </div>
        <div>
          <h4>Outgoing ({{ edges.filter(e => e.from === selectedId).length }})</h4>
          <ul>
            <li v-for="e in edges.filter(e => e.from === selectedId)" :key="e.id">
              <span class="mono">{{ nodesById.get(e.to)?.displayId || e.to }}</span> — {{ e.label }}
            </li>
            <li v-if="!edges.some(e => e.from === selectedId)" class="muted">None (terminal)</li>
          </ul>
        </div>
      </div>
    </div>
  </div>

  <ExportXmlModal
    v-if="showExport"
    :xml="exportedXml"
    :filename="exportFileName(playbook.playbookName.value)"
    @close="showExport = false"
  />
</template>

<style scoped>
.container--wide { max-width: 1320px; }
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.2rem;
  flex-wrap: wrap;
}
.page-sub {
  color: var(--slate-500);
  font-size: 0.86rem;
  max-width: 62ch;
  margin: 0;
}
.eyebrow {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--brand-dark);
  margin: 0 0 0.3em;
}
.toolbar-row {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 0.75rem;
}
.legend {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 1rem;
  padding: 0.7rem 1rem;
  margin-bottom: 1rem;
  font-size: 0.8rem;
  color: var(--navy-800);
}
.legend__item {
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  display: inline-block;
}
.dot-step { background: var(--brand); }
.dot-terminal { background: var(--ok); }
.dot-flow { background: var(--amber); }
.dot-unknown { background: var(--danger); }
.dot-dynamic { background: #6a4c93; }
.dot-root { background: var(--navy-800); }
.dot-category { background: var(--brand); }
.dot-playbook { background: var(--ok); }
.line {
  width: 20px;
  height: 2px;
  display: inline-block;
}
.line-escalation { background: var(--amber-dark); }
.legend__zoom {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 0.3rem;
}
.zoom-value {
  font-size: 0.75rem;
  color: var(--slate-500);
  width: 3.2em;
  text-align: center;
}
.routing-summary {
  padding: 1rem 1.2rem;
  margin-bottom: 1rem;
}
.routing-summary h3 {
  margin: 0 0 0.7rem;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--brand-dark);
}
.routing-summary__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.routing-summary__row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0.6rem;
  border-radius: 4px;
  cursor: pointer;
  flex-wrap: wrap;
}
.routing-summary__row:hover {
  background: var(--paper);
}
.routing-summary__row.is-selected {
  background: #fbeae7;
}
.routing-summary__category {
  font-weight: 600;
  color: var(--navy-900);
  font-size: 0.88rem;
}
.routing-summary__arrow {
  color: var(--slate-500);
}
.routing-summary__target {
  color: var(--ok);
  font-size: 0.88rem;
  font-weight: 600;
}
.routing-summary__target.is-unresolved {
  color: var(--danger);
}
.routing-summary__switch {
  margin-left: auto;
  font-size: 0.78rem;
}
.map-scroll {
  overflow: auto;
  max-height: 68vh;
  padding: 1rem;
}
.node {
  cursor: pointer;
}
.node-rect {
  fill: var(--paper-raised);
  stroke: var(--line);
  stroke-width: 1.2;
}
.node--step .node-accent { fill: var(--brand); }
.node--terminal .node-accent { fill: var(--ok); }
.node--flow .node-accent { fill: var(--amber); }
.node--unknown .node-accent { fill: var(--danger); }
.node--dynamic .node-accent { fill: #6a4c93; }
.node--root .node-accent { fill: var(--navy-800); }
.node--category .node-accent { fill: var(--brand); }
.node--playbook .node-accent { fill: var(--ok); }
.node--unknown-playbook .node-accent { fill: var(--danger); }
.comment-dot {
  fill: var(--ok);
  opacity: 0.85;
}
.node.is-selected .node-rect {
  stroke: var(--navy-900);
  stroke-width: 2;
}
.node.is-dimmed {
  opacity: 0.28;
}
.node-kind {
  font-size: 8px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  fill: var(--slate-500);
}
.node-id {
  font-size: 12px;
  font-weight: 600;
  fill: var(--navy-900);
}
.node-label {
  font-family: var(--font-sans);
  font-size: 10.5px;
  line-height: 1.25;
  color: var(--slate-500);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.edge.is-dimmed {
  opacity: 0.12;
}
.edge-label {
  font-size: 9px;
  fill: var(--navy-800);
}
.detail-drawer {
  margin-top: 1.2rem;
  padding: 1.2rem 1.4rem;
}
.detail-drawer__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.detail-id {
  margin-left: 0.6em;
  font-size: 0.9rem;
}
.detail-drawer__actions {
  display: flex;
  gap: 0.5rem;
}
.detail-drawer__label {
  color: var(--slate-500);
  margin: 0.6rem 0 1rem;
}
.detail-drawer__triggers {
  color: var(--navy-800);
  font-size: 0.85rem;
  margin: -0.4rem 0 1rem;
}
.detail-drawer__triggers strong {
  color: var(--brand-dark);
  font-weight: 600;
}
.detail-drawer__lists {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
}
.detail-drawer__lists h4 {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--brand-dark);
  margin-bottom: 0.5rem;
}
.detail-drawer__lists ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.85rem;
}
.muted { color: var(--slate-500); font-style: italic; }
@media (max-width: 720px) {
  .detail-drawer__lists { grid-template-columns: 1fr; }
}
</style>
