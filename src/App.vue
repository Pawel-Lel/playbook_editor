<script setup>
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { usePlaybooksStore } from './store/playbooks.js'

const route = useRoute()
const playbooksStore = usePlaybooksStore()
</script>

<template>
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
        <label for="playbookSwitcher" class="playbook-switcher__label">Playbook</label>
        <select
          id="playbookSwitcher"
          class="playbook-switcher__select"
          :value="playbooksStore.activePlaybookId.value"
          @change="playbooksStore.setActivePlaybookId($event.target.value)"
        >
          <option v-for="p in playbooksStore.playbooks.value" :key="p.id" :value="p.id">
            {{ p.playbookName || '(untitled playbook)' }}
          </option>
        </select>
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
    </div>
  </header>
  <main class="app-main">
    <RouterView />
  </main>
  <footer class="app-footer">
    <div class="container app-footer__inner">
      <span>Playbook Editor — data is stored locally in this browser.</span>
    </div>
  </footer>
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
  color: var(--amber);
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
  gap: 0.5rem;
  margin-right: auto;
}
.playbook-switcher__label {
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
