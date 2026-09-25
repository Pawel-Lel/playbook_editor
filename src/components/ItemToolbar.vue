<script setup>
// Shared header row for one entry in an editable list: index badge, an
// optional label, move up/down (order is significant in the XML) and remove.
defineProps({
  index: { type: Number, required: true },
  total: { type: Number, required: true },
  label: { type: String, default: '' }
})
defineEmits(['up', 'down', 'remove'])
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
