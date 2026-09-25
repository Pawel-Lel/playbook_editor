<script setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import StepForm from '../components/StepForm.vue'
import { useStepsStore } from '../store/steps.js'

const props = defineProps({ id: { type: String, required: true } })
const router = useRouter()
const store = useStepsStore()
const errorMessage = ref('')

const step = computed(() => store.getStep(props.id))

// If the ID no longer exists (deleted elsewhere / bad link), bounce to list.
watch(
  step,
  (val) => {
    if (!val) router.replace('/steps')
  },
  { immediate: true }
)

const filteredTargets = computed(() =>
  store.allReferencedTargets.value.filter((t) => t.id !== props.id)
)

function handleSubmit(data) {
  try {
    const updated = store.updateStep(props.id, data)
    router.push(`/steps/${encodeURIComponent(updated.id)}`)
  } catch (e) {
    errorMessage.value = e.message
  }
}

function handleDelete() {
  if (confirm(`Delete step "${props.id}"? This cannot be undone.`)) {
    store.deleteStep(props.id)
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
      :initial="step"
      :all-targets="filteredTargets"
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
