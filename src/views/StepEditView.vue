<script setup lang="ts">
// StepEditView — the "Edit step" page (/steps/:id). The router passes the
// :id part of the URL in as the `id` prop (see `props: true` in the router).
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import StepForm from '../components/StepForm.vue'
import { useStepsStore } from '../store/steps'
import type { Step } from '../types'

const props = defineProps<{ id: string }>()
const router = useRouter()
const stepsStore = useStepsStore()
const errorMessage = ref('')

// The step being edited (null if no step has this id).
const step = computed(() => stepsStore.getStep(props.id))

// If the ID no longer exists (deleted elsewhere / bad link), bounce to list.
// `immediate: true` makes the watcher also run once right away, not only
// on the first change.
watch(
  step,
  (currentStep) => {
    if (!currentStep) router.replace('/steps')
  },
  { immediate: true }
)

// "Next step" suggestions — every target except this step itself.
const nextStepSuggestions = computed(() =>
  stepsStore.allReferencedTargets.value.filter((target) => target.id !== props.id)
)

// Called when StepForm emits 'submit'.
function handleSubmit(submittedStep: Step): void {
  try {
    const updatedStep = stepsStore.updateStep(props.id, submittedStep)
    // The step ID may have been renamed, so follow it to its new URL.
    router.push(`/steps/${encodeURIComponent(updatedStep.id)}`)
  } catch (error) {
    errorMessage.value = error.message
  }
}

function handleDelete(): void {
  if (confirm(`Delete step "${props.id}"? This cannot be undone.`)) {
    stepsStore.deleteStep(props.id)
    router.push('/steps')
  }
}
</script>

<template>
  <div v-if="step" class="container container--narrow">
    <div class="page-head">
      <div>
        <p class="eyebrow mono">{{ step.id }}</p>
        <h1>Edit step</h1>
      </div>
      <RouterLink to="/steps" class="btn btn-ghost">← Back to list</RouterLink>
    </div>

    <StepForm
      mode="edit"
      :initial-step="step"
      :all-targets="nextStepSuggestions"
      :error-message="errorMessage"
      @submit="handleSubmit"
      @cancel="router.push('/steps')"
      @delete="handleDelete"
    />
  </div>
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
}
.eyebrow {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--brand-dark);
  margin: 0 0 0.3em;
}
h1 { margin: 0; }
</style>
