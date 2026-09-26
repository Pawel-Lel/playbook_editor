<script setup>
// App.vue — the root component: the header (logo, playbook switcher, Save
// button, menu, signed-in user) around <RouterView />, which shows the
// current page. On the login page only the page itself is shown.
//
// Vue concepts used in this file:
//  - ref(): one reactive value (`.value` in script, unwrapped in the template).
//  - watch(source, callback): runs callback whenever `source` changes.
//  - useRoute(): the current URL/page (reactive); useRouter(): changes page in code.
//  - <RouterView />: placeholder where the router renders the current page.
import { ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { usePlaybooksStore } from './store/playbooks.js'
import { useCloudSyncStore } from './store/cloudSync.js'
import { isSupported as canPickFolder } from './services/localFolder.js'

const route = useRoute()
const router = useRouter()
const playbooksStore = usePlaybooksStore()
const cloudSync = useCloudSyncStore()

// Signing out, or the Google token expiring mid-session, sends the person
// back to the login page; the router guard covers every later navigation.
watch(cloudSync.signedIn, (isSignedIn) => {
  if (!isSignedIn && !route.meta.public) {
    router.replace({ name: 'login', query: { redirect: route.fullPath } })
  }
})

function signOut() {
  cloudSync.disconnect()
}

// ---- Save button ------------------------------------------------------

const isSaving = ref(false)
// The small message under the Save button.
const saveStatus = ref({ kind: '', text: '' }) // kind: '' | 'ok' | 'error'
let hideStatusTimer = null

// Shows a message under the Save button for 4 seconds.
function showSaveStatus(kind, text) {
  saveStatus.value = { kind, text }
  clearTimeout(hideStatusTimer)
  hideStatusTimer = setTimeout(() => (saveStatus.value = { kind: '', text: '' }), 4000)
}

// Saves the active playbook's .xml into the chosen local folder.
// pickFolder = true ("Change folder") asks for a new folder first.
async function saveToLocalFolder(pickFolder = false) {
  isSaving.value = true
  try {
    const { fileName, folderName } = await playbooksStore.saveActiveToLocalFolder({ pickFolder })
    showSaveStatus('ok', folderName ? `Saved ${fileName} to ${folderName}/` : `Downloaded ${fileName}`)
  } catch (error) {
    // AbortError = the person closed the folder picker; not worth a message.
    if (error.name !== 'AbortError') showSaveStatus('error', `Save failed: ${error.message}`)
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <!-- The login page (a "public" route) is shown on its own, without the header. -->
  <RouterView v-if="route.meta.public" />
  <template v-else>
  <header class="app-header">
    <div class="app-header__inner">
      <RouterLink to="/steps" class="brand">
        <span class="brand__mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path d="M4 12 L12 5 L20 12 M6.5 10 V19 H17.5 V10" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
        <span class="brand__text">
          <strong>Homeserve</strong>
          <span class="brand__sub">Diagnostic playbook manager</span>
        </span>
      </RouterLink>

      <div class="playbook-switcher">
        <label for="playbookSwitcher" class="playbook-switcher__label">Active Playbook</label>
        <select
          id="playbookSwitcher"
          class="playbook-switcher__select"
          :value="playbooksStore.activePlaybookId.value"
          @change="playbooksStore.setActivePlaybookId($event.target.value)"
        >
          <option v-for="playbook in playbooksStore.playbooks.value" :key="playbook.id" :value="playbook.id">
            {{ playbook.playbookName || '(untitled playbook)' }}
          </option>
        </select>
      </div>

      <div class="local-save">
        <button
          class="btn btn-primary local-save__btn"
          :disabled="isSaving"
          title="Save the active playbook as .xml in a local folder (creates or overwrites the file)"
          @click="saveToLocalFolder()"
        >
          {{ isSaving ? 'Saving…' : 'Save' }}
        </button>
        <button
          v-if="canPickFolder()"
          class="local-save__folder"
          :disabled="isSaving"
          title="Choose a different local folder, then save"
          @click="saveToLocalFolder(true)"
        >
          Change folder
        </button>
        <span v-if="saveStatus.text" class="local-save__status" :class="saveStatus.kind" role="status">
          {{ saveStatus.text }}
        </span>
      </div>

      <nav class="app-nav">
        <RouterLink to="/playbooks" class="app-nav__link" :class="{ 'is-active': route.path === '/playbooks' }">
          Playbook List
        </RouterLink>
        <RouterLink to="/flow-map" class="app-nav__link" :class="{ 'is-active': route.path === '/flow-map' }">
          Flow map
        </RouterLink>
        <RouterLink to="/playbook" class="app-nav__link" :class="{ 'is-active': route.path === '/playbook' }">
          Playbook Editor
        </RouterLink>
        <RouterLink to="/steps" class="app-nav__link" :class="{ 'is-active': route.path.startsWith('/steps') }">
          Steps Editor
        </RouterLink>
        <RouterLink to="/cloud-sync" class="app-nav__link" :class="{ 'is-active': route.path === '/cloud-sync' }">
          Cloud sync
        </RouterLink>
      </nav>

      <div class="app-user">
        <span v-if="cloudSync.userEmail.value" class="app-user__email mono" :title="cloudSync.userEmail.value">
          {{ cloudSync.userEmail.value }}
        </span>
        <button class="app-user__signout" @click="signOut">Sign out</button>
      </div>
    </div>
  </header>
  <main class="app-main">
    <RouterView />
  </main>
  <footer class="app-footer">
    <div class="container app-footer__inner">
    </div>
  </footer>
  </template>
</template>

<style scoped>
.app-header {
  background: var(--navy-800);
  color: #eef2f4;
  border-bottom: 3px solid var(--amber);
}
.app-header__inner {
  max-width: 1180px;
  margin: 0 auto;
  padding: 0.9rem 1.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  flex-wrap: wrap;
}
.brand {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  text-decoration: none;
  color: #fff;
}
.brand__mark {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 6px;
  background: var(--navy-900);
  color: var(--logo-red);
  border: 1px solid var(--slate-500);
}
.brand__text {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}
.brand__text strong {
  font-size: 1rem;
  letter-spacing: -0.01em;
}
.brand__sub {
  font-size: 0.72rem;
  color: var(--slate-300);
  font-family: var(--font-mono);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.playbook-switcher {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  margin-right: auto;
}
.playbook-switcher__label {
  min-width: 110px;
  margin-left: 450px;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--slate-300);
  font-family: var(--font-mono);
}
.playbook-switcher__select {
  background: var(--navy-700);
  color: #fff;
  border: 1px solid var(--slate-500);
  border-radius: 4px;
  padding: 0.4em 0.6em;
  font-size: 0.84rem;
  font-weight: 600;
  max-width: 220px;
}
.playbook-switcher__select:focus {
  outline: 2px solid var(--amber);
  outline-offset: 1px;
}
.local-save {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.local-save__btn {
  padding: 0.45em 1em;
}
.local-save__folder {
  background: none;
  border: none;
  padding: 0;
  color: var(--slate-300);
  font-size: 0.74rem;
  text-decoration: underline;
  cursor: pointer;
}
.local-save__folder:hover {
  color: #fff;
}
.local-save__status {
  position: absolute;
  top: calc(100% + 0.45rem);
  left: 0;
  white-space: nowrap;
  font-size: 0.74rem;
  font-family: var(--font-mono);
  padding: 0.3em 0.6em;
  border-radius: 4px;
  background: var(--navy-900);
  z-index: 30;
}
.local-save__status.ok { color: #9fd8b4; }
.local-save__status.error { color: #ffb4a8; }
.app-nav {
  display: flex;
  gap: 0.25rem;
}
.app-nav__link {
  color: var(--slate-300);
  text-decoration: none;
  font-size: 0.86rem;
  font-weight: 600;
  padding: 0.5em 0.9em;
  border-radius: 4px;
  border: 1px solid transparent;
}
.app-nav__link:hover {
  color: #fff;
}
.app-nav__link.is-active {
  color: #fff;
  background: var(--amber-dark);
}
.app-user {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.app-user__email {
  font-size: 0.74rem;
  color: var(--slate-300);
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.app-user__signout {
  background: none;
  border: 1px solid var(--slate-500);
  border-radius: 4px;
  color: var(--slate-300);
  font-size: 0.78rem;
  font-weight: 600;
  padding: 0.35em 0.7em;
  cursor: pointer;
}
.app-user__signout:hover {
  color: #fff;
  border-color: var(--slate-300);
}
.app-main {
  flex: 1;
}
.app-footer {
  border-top: 1px solid var(--line);
}
.app-footer__inner {
  padding: 1rem 1.5rem;
  font-size: 0.78rem;
  color: var(--slate-500);
  font-family: var(--font-mono);
}
</style>
