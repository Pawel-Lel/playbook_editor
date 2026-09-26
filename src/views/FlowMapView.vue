<script setup>
// FlowMapView — draws the active playbook as a node/edge diagram (SVG).
//
// Vue concepts used in this file:
//  - <script setup>: everything declared at the top level here (variables,
//    functions, imports) is automatically usable in the <template> below.
//  - ref(value): a reactive "box" holding one value. Read/write it in
//    script code via `.value`; in the template Vue unwraps it for you, so
//    you write just `zoomLevel`, not `zoomLevel.value`.
//  - computed(() => ...): a value derived from other reactive data. Vue
//    re-runs the function automatically whenever that data changes, and
//    caches the result in between. Also read via `.value` in script code.
import { computed, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useStepsStore } from '../store/steps.js'
import { usePlaybookStore } from '../store/playbook.js'
import { usePlaybooksStore } from '../store/playbooks.js'
import { buildLlmInstructionsXml, exportFileName } from '../utils/xmlExport.js'
import ExportXmlModal from '../components/ExportXmlModal.vue'

// useRouter() gives access to the app's router, used to change pages in code.
const router = useRouter()
// The three stores (shared app state) this page reads from:
const stepsStore = useStepsStore() // dialog steps of the active playbook
const playbookStore = usePlaybookStore() // settings of the active playbook
const playbooksStore = usePlaybooksStore() // the list of all playbooks

// ---- Export XML modal ---------------------------------------------------

const isExportModalOpen = ref(false)
// The full XML document for the active playbook. Because it's computed, it
// is rebuilt automatically whenever the playbook or its steps change.
const exportedXml = computed(() =>
  buildLlmInstructionsXml(playbookStore.toExportPayload(), stepsStore.steps.value)
)

// ---- Diagram sizing (in SVG units / pixels) -----------------------------

const NODE_WIDTH = 216
const NODE_HEIGHT = 78
const COLUMN_GAP = 130 // horizontal space between columns of nodes
const ROW_GAP = 34 // vertical space between nodes in one column

// Id of the node the person clicked on (null = nothing selected).
const selectedNodeId = ref(null)
// 1 = 100%. Changed with the +/− buttons, see setZoomLevel().
const zoomLevel = ref(1)

// A router/triage-style playbook has routing categories instead of dialog
// steps — it gets a different graph (this playbook → category → target
// playbook) rather than the step-classification flow below.
const isRoutingPlaybook = computed(
  () => stepsStore.steps.value.length === 0 && playbookStore.routingCategories.value.length > 0
)

// ---- Build the step-flow graph ---------------------------------------
// Nodes are every step plus every target a classification points at;
// edges are the classifications' "next step" links.

const stepNodesById = computed(() => {
  const nodeMap = new Map()
  stepsStore.allReferencedTargets.value.forEach((target) => nodeMap.set(target.id, target))
  return nodeMap
})

const stepEdges = computed(() => {
  const edgeList = []
  stepsStore.steps.value.forEach((step) => {
    step.classifications.forEach((classification) => {
      if (!classification.nextStep) return
      edgeList.push({
        id: classification.id,
        from: step.id,
        to: classification.nextStep,
        label: classification.classificationId || classification.triggerCondition || '',
        // Drawn dashed: the link hands off to a flow, or is the "don't know" path.
        isEscalation:
          (classification.actions || []).some((action) => action.toolType === 'Flow_Invocation') ||
          /do.?not.?know/i.test(classification.triggerCondition || '')
      })
    })
  })
  return edgeList
})

// ---- Build the routing graph -------------------------------------------
// Nodes: this playbook (the root) → each routing category → the playbook
// that category routes to.

// Pulls "Water Taps" out of an action like "${PLAYBOOK:Water Taps}".
function extractPlaybookTarget(actionText) {
  const match = String(actionText || '').match(/\$\{PLAYBOOK:([^}]+)\}/)
  return match ? match[1].trim() : ''
}

// Finds a loaded playbook by name (case-insensitive), or null.
function findTargetPlaybook(playbookName) {
  const wantedName = playbookName.trim().toLowerCase()
  return (
    playbooksStore.playbooks.value.find(
      (candidate) => (candidate.playbookName || '').trim().toLowerCase() === wantedName
    ) || null
  )
}

const ROOT_NODE_ID = '__playbook_root__'

const routingNodesById = computed(() => {
  const nodeMap = new Map()
  nodeMap.set(ROOT_NODE_ID, {
    id: ROOT_NODE_ID,
    displayId: playbookStore.playbookName.value || 'This playbook',
    kind: 'root',
    label: 'Triage entry point'
  })
  playbookStore.routingCategories.value.forEach((category) => {
    const categoryNodeId = `cat:${category.id}`
    const targetName = extractPlaybookTarget(category.action)
    nodeMap.set(categoryNodeId, {
      id: categoryNodeId,
      displayId: category.name || '(unnamed category)',
      kind: 'category',
      label: targetName ? `→ ${targetName}` : category.action || '(no routing action set)'
    })
    if (!targetName) return
    const targetPlaybook = findTargetPlaybook(targetName)
    const targetNodeId = targetPlaybook ? `playbook:${targetPlaybook.id}` : `unknown-playbook:${targetName}`
    // Several categories can route to the same playbook — add its node once.
    if (!nodeMap.has(targetNodeId)) {
      nodeMap.set(targetNodeId, {
        id: targetNodeId,
        displayId: targetPlaybook ? targetPlaybook.playbookName : targetName,
        kind: targetPlaybook ? 'playbook' : 'unknown-playbook',
        label: targetPlaybook ? 'In this workspace — double-click to switch' : 'Not found in this workspace',
        targetPlaybookId: targetPlaybook ? targetPlaybook.id : null
      })
    }
  })
  return nodeMap
})

const routingEdges = computed(() => {
  const edgeList = []
  playbookStore.routingCategories.value.forEach((category) => {
    const categoryNodeId = `cat:${category.id}`
    edgeList.push({ id: `e-root-${category.id}`, from: ROOT_NODE_ID, to: categoryNodeId, label: '', isEscalation: false })
    const targetName = extractPlaybookTarget(category.action)
    if (!targetName) return
    const targetPlaybook = findTargetPlaybook(targetName)
    const targetNodeId = targetPlaybook ? `playbook:${targetPlaybook.id}` : `unknown-playbook:${targetName}`
    edgeList.push({
      id: `e-cat-${category.id}`,
      from: categoryNodeId,
      to: targetNodeId,
      label: 'routes to',
      isEscalation: !targetPlaybook // dashed when the target playbook isn't loaded
    })
  })
  return edgeList
})

// The trigger phrases of the category behind a "cat:..." node id.
function categoryTriggersFor(categoryNodeId) {
  const category = playbookStore.routingCategories.value.find(
    (candidate) => `cat:${candidate.id}` === categoryNodeId
  )
  return category?.triggers || ''
}

// A plain, unambiguous "category → target playbook" list shown alongside
// the graph — guarantees the relationship is readable even before you've
// looked at (or interacted with) the diagram itself.
const routingSummary = computed(() => {
  if (!isRoutingPlaybook.value) return []
  return playbookStore.routingCategories.value.map((category) => {
    const targetName = extractPlaybookTarget(category.action)
    const targetPlaybook = targetName ? findTargetPlaybook(targetName) : null
    return {
      id: category.id,
      categoryNodeId: `cat:${category.id}`,
      name: category.name || '(unnamed category)',
      targetName: targetName || '(no routing action set)',
      resolved: !!targetPlaybook,
      targetPlaybookId: targetPlaybook ? targetPlaybook.id : null
    }
  })
})

function switchToPlaybookId(playbookId) {
  playbooksStore.setActivePlaybookId(playbookId)
  selectedNodeId.value = null
}

// ---- Graph the template actually renders (switches on playbook shape) --

const nodesById = computed(() => (isRoutingPlaybook.value ? routingNodesById.value : stepNodesById.value))
const edges = computed(() => (isRoutingPlaybook.value ? routingEdges.value : stepEdges.value))

const pageSubtitle = computed(() => {
  if (isRoutingPlaybook.value) {
    const categoryCount = playbookStore.routingCategories.value.length
    return `${categoryCount} routing categor${categoryCount === 1 ? 'y' : 'ies'}. Double-click a resolved target playbook to switch to it.`
  }
  return `${positionedNodes.value.length} nodes · ${edges.value.length} classification links. Columns are ordered by ` +
    'distance from the entry steps; click a node to trace its connections.'
})

const svgAriaLabel = computed(() =>
  isRoutingPlaybook.value
    ? 'Diagram of routing categories and the playbooks they route to'
    : 'Diagram of relationships between dialog steps'
)

// ---- Layout: where each node goes -------------------------------------
// Layered (longest-path) layout via topological levelling, robust to cycles:
// a node's column ("level") is one more than the deepest node linking to it,
// so entry steps sit in column 0 and everything flows left to right.
const layout = computed(() => {
  const nodeIds = Array.from(nodesById.value.keys())
  const incomingByNodeId = new Map(nodeIds.map((nodeId) => [nodeId, []]))
  edges.value.forEach((edge) => {
    if (incomingByNodeId.has(edge.to)) incomingByNodeId.get(edge.to).push(edge.from)
  })

  const levelByNodeId = new Map()
  const nodesBeingVisited = new Set() // detects loops (A → B → A)

  function levelOf(nodeId) {
    if (levelByNodeId.has(nodeId)) return levelByNodeId.get(nodeId)
    if (nodesBeingVisited.has(nodeId)) return 0 // cycle guard
    nodesBeingVisited.add(nodeId)
    const predecessorIds = incomingByNodeId.get(nodeId) || []
    let nodeLevel = 0
    predecessorIds.forEach((predecessorId) => {
      nodeLevel = Math.max(nodeLevel, levelOf(predecessorId) + 1)
    })
    nodesBeingVisited.delete(nodeId)
    levelByNodeId.set(nodeId, nodeLevel)
    return nodeLevel
  }

  nodeIds.forEach((nodeId) => levelOf(nodeId))

  // Group node ids into columns by level.
  const nodeIdsByColumn = new Map()
  nodeIds.forEach((nodeId) => {
    const nodeLevel = levelByNodeId.get(nodeId)
    if (!nodeIdsByColumn.has(nodeLevel)) nodeIdsByColumn.set(nodeLevel, [])
    nodeIdsByColumn.get(nodeLevel).push(nodeId)
  })

  // Turn column/row numbers into x/y coordinates.
  const positionByNodeId = new Map()
  const deepestLevel = Math.max(0, ...Array.from(nodeIdsByColumn.keys()))
  let tallestColumnSize = 0

  for (let columnLevel = 0; columnLevel <= deepestLevel; columnLevel++) {
    const columnNodeIds = (nodeIdsByColumn.get(columnLevel) || []).sort((first, second) => first.localeCompare(second))
    tallestColumnSize = Math.max(tallestColumnSize, columnNodeIds.length)
    columnNodeIds.forEach((nodeId, rowIndex) => {
      positionByNodeId.set(nodeId, {
        x: columnLevel * (NODE_WIDTH + COLUMN_GAP) + 24,
        y: rowIndex * (NODE_HEIGHT + ROW_GAP) + 24
      })
    })
  }

  const width = (deepestLevel + 1) * (NODE_WIDTH + COLUMN_GAP) + 48
  const height = tallestColumnSize * (NODE_HEIGHT + ROW_GAP) + 48

  return { positions: positionByNodeId, width: Math.max(width, 800), height: Math.max(height, 500) }
})

// Every node with its x/y position merged in — what the template draws.
const positionedNodes = computed(() =>
  Array.from(nodesById.value.values()).map((node) => {
    const position = layout.value.positions.get(node.id) || { x: 0, y: 0 }
    return { ...node, ...position }
  })
)

function positionedNodeById(nodeId) {
  return positionedNodes.value.find((node) => node.id === nodeId)
}

// The node's title, shortened so it fits inside the box.
function nodeDisplayId(node) {
  const text = node.displayId || node.id
  return text.length > 26 ? text.slice(0, 25) + '…' : text
}

// Hover text: a category's triggers, or a step's comment.
function nodeTooltip(nodeId) {
  if (isRoutingPlaybook.value) {
    return categoryTriggersFor(nodeId)
  }
  return stepsStore.getStep(nodeId)?.comment || ''
}

// SVG path data for a smooth curve from the right edge of the source node
// to the left edge of the target node (a cubic Bézier: "M start C ...").
function edgePath(edge) {
  const fromNode = positionedNodeById(edge.from)
  const toNode = positionedNodeById(edge.to)
  if (!fromNode || !toNode) return ''
  const startX = fromNode.x + NODE_WIDTH
  const startY = fromNode.y + NODE_HEIGHT / 2
  const endX = toNode.x
  const endY = toNode.y + NODE_HEIGHT / 2
  const curveStrength = Math.max(60, (endX - startX) / 2)
  return `M ${startX} ${startY} C ${startX + curveStrength} ${startY}, ${endX - curveStrength} ${endY}, ${endX} ${endY}`
}

// Where to put an edge's label: halfway between its two nodes.
function edgeMidpoint(edge) {
  const fromNode = positionedNodeById(edge.from)
  const toNode = positionedNodeById(edge.to)
  if (!fromNode || !toNode) return { x: 0, y: 0 }
  return {
    x: (fromNode.x + NODE_WIDTH + toNode.x) / 2,
    y: (fromNode.y + toNode.y) / 2 + NODE_HEIGHT / 2
  }
}

// ---- Selection: highlight the clicked node and its direct links --------

const edgeIdsTouchingSelection = computed(() => {
  if (!selectedNodeId.value) return new Set()
  return new Set(
    edges.value
      .filter((edge) => edge.from === selectedNodeId.value || edge.to === selectedNodeId.value)
      .map((edge) => edge.id)
  )
})

function isEdgeDimmed(edge) {
  return selectedNodeId.value && !edgeIdsTouchingSelection.value.has(edge.id)
}
function isNodeDimmed(node) {
  if (!selectedNodeId.value) return false
  if (node.id === selectedNodeId.value) return false
  return !edges.value.some(
    (edge) =>
      (edge.from === selectedNodeId.value && edge.to === node.id) ||
      (edge.to === selectedNodeId.value && edge.from === node.id)
  )
}

// Clicking the selected node again deselects it.
function selectNode(nodeId) {
  selectedNodeId.value = selectedNodeId.value === nodeId ? null : nodeId
}

// Incoming/outgoing edges of the selected node, for the detail drawer.
const selectedIncomingEdges = computed(() => edges.value.filter((edge) => edge.to === selectedNodeId.value))
const selectedOutgoingEdges = computed(() => edges.value.filter((edge) => edge.from === selectedNodeId.value))

function goToStep(stepId) {
  if (nodesById.value.get(stepId)?.kind === 'step') {
    router.push(`/steps/${encodeURIComponent(stepId)}`)
  }
}

function switchToTargetPlaybook(nodeId) {
  const node = nodesById.value.get(nodeId)
  if (node?.kind === 'playbook' && node.targetPlaybookId) {
    playbooksStore.setActivePlaybookId(node.targetPlaybookId)
    selectedNodeId.value = null
  }
}

// Double-click: open a step for editing, or switch to a target playbook.
function handleNodeActivate(nodeId) {
  const node = nodesById.value.get(nodeId)
  if (!node) return
  if (node.kind === 'step') {
    goToStep(nodeId)
  } else if (node.kind === 'playbook') {
    switchToTargetPlaybook(nodeId)
  }
}

// CSS class for the colored badge of each node kind (see main.css).
function badgeClass(nodeKind) {
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
  }[nodeKind] || 'badge-unknown'
}

// Keeps the zoom between 40% and 140%.
function setZoomLevel(newZoomLevel) {
  zoomLevel.value = Math.min(1.4, Math.max(0.4, newZoomLevel))
}
</script>

<!--
  Template syntax used below:
   - {{ expression }}   prints a value as text.
   - :attr="expr"       (short for v-bind) sets an attribute from JavaScript.
   - @event="handler"   (short for v-on) runs code on an event, e.g. @click.
   - v-if / v-else      renders an element only when a condition is true.
   - v-for="item in list" :key="item.id"
                        repeats an element once per list item; `key` must be
                        unique so Vue can track which element is which.
-->
<template>
  <div class="container container--wide">
    <div class="page-head">
      <div>
        <p class="eyebrow mono">{{ playbookStore.playbookName.value || '(untitled playbook)' }}</p>
        <h1>Flow map</h1>
        <p class="page-sub">{{ pageSubtitle }}</p>
      </div>
      <RouterLink to="/steps" class="btn btn-secondary">← Back to steps</RouterLink>
    </div>

    <div class="toolbar-row">
      <button class="btn btn-secondary" @click="isExportModalOpen = true">Export XML</button>
    </div>

    <!-- Legend: explains node colors; different for the two playbook shapes. -->
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
        <button class="btn btn-ghost" @click="setZoomLevel(zoomLevel - 0.15)" aria-label="Zoom out">−</button>
        <span class="mono zoom-value">{{ Math.round(zoomLevel * 100) }}%</span>
        <button class="btn btn-ghost" @click="setZoomLevel(zoomLevel + 0.15)" aria-label="Zoom in">+</button>
      </div>
    </div>

    <!-- Text summary of the routing graph (router/triage playbooks only). -->
    <div v-if="isRoutingPlaybook" class="routing-summary panel">
      <h3>Category → target playbook</h3>
      <ul class="routing-summary__list">
        <li
          v-for="summaryRow in routingSummary"
          :key="summaryRow.id"
          class="routing-summary__row"
          :class="{ 'is-selected': selectedNodeId === summaryRow.categoryNodeId }"
          @click="selectNode(summaryRow.categoryNodeId)"
        >
          <span class="routing-summary__category">{{ summaryRow.name }}</span>
          <span class="routing-summary__arrow" aria-hidden="true">→</span>
          <span class="routing-summary__target" :class="{ 'is-unresolved': !summaryRow.resolved }">
            {{ summaryRow.targetName }}
          </span>
          <span class="badge" :class="summaryRow.resolved ? 'badge-playbook' : 'badge-unknown'">
            {{ summaryRow.resolved ? 'in workspace' : 'not found' }}
          </span>
          <!-- @click.stop: handle the click here and stop it from also
               reaching the row's own @click (which would select the row). -->
          <button
            v-if="summaryRow.resolved"
            type="button"
            class="btn btn-ghost routing-summary__switch"
            @click.stop="switchToPlaybookId(summaryRow.targetPlaybookId)"
          >
            Switch →
          </button>
        </li>
      </ul>
    </div>

    <!-- The diagram itself. viewBox is the drawing's own coordinate space;
         width/height scale it on screen by the zoom level. -->
    <div class="map-scroll panel">
      <svg
        :viewBox="`0 0 ${layout.width} ${layout.height}`"
        :width="layout.width * zoomLevel"
        :height="layout.height * zoomLevel"
        role="img"
        :aria-label="svgAriaLabel"
      >
        <!-- Arrow heads, referenced by the edges' marker-end below. -->
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" style="fill: var(--slate-500)" />
          </marker>
          <marker id="arrow-escalation" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" style="fill: var(--amber-dark)" />
          </marker>
        </defs>

        <!-- Edges first, so the nodes are drawn on top of them. -->
        <g class="edges">
          <g
            v-for="edge in edges"
            :key="edge.id"
            class="edge"
            :class="{ 'is-dimmed': isEdgeDimmed(edge), 'is-escalation': edge.isEscalation }"
          >
            <path
              :d="edgePath(edge)"
              fill="none"
              :style="{ stroke: edge.isEscalation ? 'var(--amber-dark)' : 'var(--slate-500)' }"
              stroke-width="1.6"
              :stroke-dasharray="edge.isEscalation ? '5 3' : null"
              :marker-end="edge.isEscalation ? 'url(#arrow-escalation)' : 'url(#arrow)'"
            />
            <g v-if="!isEdgeDimmed(edge) && edge.label" :transform="`translate(${edgeMidpoint(edge).x}, ${edgeMidpoint(edge).y})`">
              <rect
                x="-3"
                y="-9"
                :width="Math.min(220, (edge.label.length * 5.3) + 10)"
                height="16"
                rx="2"
                fill="var(--paper)"
                stroke="var(--line)"
              />
              <text x="1" y="3" class="edge-label mono">{{ edge.label.slice(0, 38) }}{{ edge.label.length > 38 ? '…' : '' }}</text>
            </g>
          </g>
        </g>

        <g class="nodes">
          <g
            v-for="node in positionedNodes"
            :key="node.id"
            :transform="`translate(${node.x}, ${node.y})`"
            class="node"
            :class="[`node--${node.kind}`, { 'is-selected': selectedNodeId === node.id, 'is-dimmed': isNodeDimmed(node) }]"
            @click="selectNode(node.id)"
            @dblclick="handleNodeActivate(node.id)"
            tabindex="0"
            role="button"
            :aria-label="`${node.displayId || node.id}: ${node.label}`"
          >
            <title v-if="nodeTooltip(node.id)">{{ nodeTooltip(node.id) }}</title>
            <rect :width="NODE_WIDTH" :height="NODE_HEIGHT" rx="5" class="node-rect" />
            <rect :width="4" :height="NODE_HEIGHT" rx="2" class="node-accent" />
            <text x="14" y="20" class="node-kind mono">{{ node.kind }}</text>
            <text x="14" y="38" class="node-id mono">{{ nodeDisplayId(node) }}</text>
            <!-- foreignObject lets normal HTML (which wraps text) sit inside SVG. -->
            <foreignObject x="14" y="44" :width="NODE_WIDTH - 28" height="30">
              <div xmlns="http://www.w3.org/1999/xhtml" class="node-label">{{ node.label }}</div>
            </foreignObject>
            <circle v-if="nodeTooltip(node.id)" :cx="NODE_WIDTH - 12" cy="12" r="4" class="comment-dot" />
          </g>
        </g>
      </svg>
    </div>

    <!-- Details of the selected node: what links into it and out of it. -->
    <div v-if="selectedNodeId" class="detail-drawer panel">
      <div class="detail-drawer__head">
        <div>
          <span class="badge" :class="badgeClass(nodesById.get(selectedNodeId)?.kind)">
            {{ nodesById.get(selectedNodeId)?.kind }}
          </span>
          <span class="mono detail-id">{{ nodesById.get(selectedNodeId)?.displayId || selectedNodeId }}</span>
        </div>
        <div class="detail-drawer__actions">
          <RouterLink
            v-if="nodesById.get(selectedNodeId)?.kind === 'step'"
            :to="`/steps/${encodeURIComponent(selectedNodeId)}`"
            class="btn btn-secondary"
          >
            Open step →
          </RouterLink>
          <button
            v-else-if="nodesById.get(selectedNodeId)?.kind === 'playbook'"
            class="btn btn-secondary"
            @click="switchToTargetPlaybook(selectedNodeId)"
          >
            Switch to this playbook →
          </button>
          <button class="btn btn-ghost" @click="selectedNodeId = null">Close</button>
        </div>
      </div>
      <p class="detail-drawer__label">{{ nodesById.get(selectedNodeId)?.label }}</p>
      <p v-if="isRoutingPlaybook && nodesById.get(selectedNodeId)?.kind === 'category'" class="detail-drawer__triggers">
        <strong>Triggers:</strong> {{ categoryTriggersFor(selectedNodeId) }}
      </p>
      <div class="detail-drawer__lists">
        <div>
          <h4>Incoming ({{ selectedIncomingEdges.length }})</h4>
          <ul>
            <li v-for="edge in selectedIncomingEdges" :key="edge.id">
              <span class="mono">{{ nodesById.get(edge.from)?.displayId || edge.from }}</span> — {{ edge.label }}
            </li>
            <li v-if="!selectedIncomingEdges.length" class="muted">None (entry point)</li>
          </ul>
        </div>
        <div>
          <h4>Outgoing ({{ selectedOutgoingEdges.length }})</h4>
          <ul>
            <li v-for="edge in selectedOutgoingEdges" :key="edge.id">
              <span class="mono">{{ nodesById.get(edge.to)?.displayId || edge.to }}</span> — {{ edge.label }}
            </li>
            <li v-if="!selectedOutgoingEdges.length" class="muted">None (terminal)</li>
          </ul>
        </div>
      </div>
    </div>
  </div>

  <ExportXmlModal
    v-if="isExportModalOpen"
    :xml="exportedXml"
    :filename="exportFileName(playbookStore.playbookName.value)"
    @close="isExportModalOpen = false"
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
.line-escalation { background: repeating-linear-gradient(90deg, var(--amber-dark) 0 5px, transparent 5px 8px); }
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
  background: #edeff2;
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
