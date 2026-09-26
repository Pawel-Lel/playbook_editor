<script setup lang="ts">
// Shared header row for one entry in an editable list: index badge, an
// optional label, move up/down (order is significant in the XML) and remove.
withDefaults(
  defineProps<{
    index: number // position in the list, from 0
    total: number // how many items the list has
    label?: string
  }>(),
  { label: '' }
)
// The buttons don't change anything themselves — they send an event
// ($emit('up') etc. below) and the parent decides what to do, e.g.
// <ItemToolbar @up="playbookStore.moveItem('escalations', escalation.id, -1)" />
defineEmits<{ up: []; down: []; remove: [] }>()
</script>

<template>
  <div class="item-row__top">
    <span class="mono item-index">
      #{{ index + 1 }}<template v-if="label"> &middot; {{ label }}</template>
    </span>
    <span class="item-row__actions">
      <button type="button" class="btn btn-ghost" :disabled="index === 0" title="Move up" @click="$emit('up')">↑</button>
      <button type="button" class="btn btn-ghost" :disabled="index === total - 1" title="Move down" @click="$emit('down')">↓</button>
      <button type="button" class="btn btn-ghost" @click="$emit('remove')">Remove</button>
    </span>
  </div>
</template>
