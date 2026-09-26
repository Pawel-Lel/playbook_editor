<script setup>
// StepCreateView — the "Create a step" page (/steps/new). The form itself
// lives in StepForm.vue; this page only saves what the form submits.
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import StepForm from '../components/StepForm.vue'
import { useStepsStore } from '../store/steps.js'

const router = useRouter()
const stepsStore = useStepsStore()
// Shown at the top of the form when saving fails (e.g. duplicate step ID).
const errorMessage = ref('')

// Called when StepForm emits 'submit' (see @submit below).
function handleSubmit(submittedStep) {
  try {
    const createdStep = stepsStore.createStep(submittedStep)
    // Go to the new step's edit page.
    router.push(`/steps/${encodeURIComponent(createdStep.id)}`)
  } catch (error) {
    errorMessage.value = error.message
  }
}
</script>

<template>
  <div class="container container--narrow">
    <div class="page-head">
      <div>
        <p class="eyebrow">New dialog step</p>
        <h1>Create a step</h1>
      </div>
      <RouterLink to="/steps" class="btn btn-ghost">← Back to list</RouterLink>
    </div>

    <StepForm
      mode="create"
      :initial-step="null"
      :all-targets="stepsStore.allReferencedTargets.value"
      :error-message="errorMessage"
      @submit="handleSubmit"
      @cancel="router.push('/steps')"
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
  font-family: var(--font-mono);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--brand-dark);
  margin: 0 0 0.3em;
}
h1 { margin: 0; }
</style>
