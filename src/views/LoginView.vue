<script setup>
// LoginView — the page everyone who isn't signed in sees (/login).
// onMounted(callback): runs callback once, right after this page appears.
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCloudSyncStore } from '../store/cloudSync.js'
import { prepareSignIn } from '../services/gcsClient.js'

const route = useRoute()
const router = useRouter()
const cloudSync = useCloudSyncStore()

const isSigningIn = ref(false)
const signInError = ref('')

// Load Google's sign-in script as soon as the page appears, so the popup
// can open instantly when the button is clicked.
onMounted(() => {
  prepareSignIn(cloudSync.clientId).catch((error) => {
    signInError.value = error.message
  })
})

async function signIn() {
  isSigningIn.value = true
  signInError.value = ''
  try {
    await cloudSync.connect()
    // Go back to the page the person originally asked for (?redirect=...).
    const redirectPath = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    router.replace(redirectPath)
  } catch (error) {
    signInError.value = error.message
  } finally {
    isSigningIn.value = false
  }
}
</script>

<template>
  <div class="login">
    <div class="login__card panel">
      <span class="login__mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="26" height="26">
          <path d="M4 12 L12 5 L20 12 M6.5 10 V19 H17.5 V10" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
      <h1>Homeserve</h1>
      <p class="login__sub mono">Diagnostic playbook manager</p>

      <p v-if="cloudSync.sessionExpired.value" class="login__notice">
        Your session expired. Sign in again to carry on — your local changes are kept.
      </p>
      <p v-else class="login__text">Sign in with your Google account to continue.</p>

      <p v-if="!cloudSync.clientId" class="login__error">
        Sign-in is not configured for this deployment — set the
        <span class="mono">GOOGLE_OAUTH_CLIENT_ID</span> environment variable.
      </p>

      <button class="btn btn-primary login__btn" :disabled="isSigningIn || !cloudSync.clientId" @click="signIn">
        {{ isSigningIn ? 'Signing in…' : 'Sign in with Google' }}
      </button>

      <p v-if="signInError" class="login__error" role="alert">{{ signInError }}</p>
    </div>
  </div>
</template>

<style scoped>
.login {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 2rem 1rem;
  background: var(--navy-800);
}
.login__card {
  width: min(380px, 100%);
  padding: 2rem 1.8rem;
  text-align: center;
}
.login__mark {
  display: inline-grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 8px;
  background: var(--navy-900);
  color: var(--logo-red);
  border: 1px solid var(--slate-500);
}
.login h1 {
  margin: 0.7rem 0 0.1rem;
  font-size: 1.35rem;
}
.login__sub {
  margin: 0 0 1.4rem;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--slate-500);
}
.login__text,
.login__notice {
  font-size: 0.9rem;
  color: var(--slate-500);
  margin: 0 0 1.2rem;
}
.login__notice {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 0.6em 0.8em;
  color: var(--navy-900);
}
.login__btn {
  width: 100%;
  padding: 0.7em 1em;
}
.login__error {
  background: #f8ece9;
  border: 1px solid #e0b3a6;
  color: var(--danger);
  padding: 0.6em 0.9em;
  border-radius: 4px;
  font-size: 0.85rem;
  margin: 1rem 0 0;
  text-align: left;
}
</style>
