import { createRouter, createWebHashHistory } from 'vue-router'
import StepsListView from '../views/StepsListView.vue'
import StepEditView from '../views/StepEditView.vue'
import StepCreateView from '../views/StepCreateView.vue'
import FlowMapView from '../views/FlowMapView.vue'
import PlaybookSettingsView from '../views/PlaybookSettingsView.vue'
import CloudSyncView from '../views/CloudSyncView.vue'
import PlaybooksView from '../views/PlaybooksView.vue'
import LoginView from '../views/LoginView.vue'
import { useCloudSyncStore } from '../store/cloudSync.js'

// Which component (page) is shown for which URL. `props: true` passes the
// :id part of the URL to the component as a prop named `id`.
const routes = [
  { path: '/', redirect: '/steps' },
  { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
  { path: '/playbooks', name: 'playbooks', component: PlaybooksView },
  { path: '/steps', name: 'steps-list', component: StepsListView },
  { path: '/steps/new', name: 'steps-create', component: StepCreateView },
  { path: '/steps/:id', name: 'steps-edit', component: StepEditView, props: true },
  { path: '/flow-map', name: 'flow-map', component: FlowMapView },
  { path: '/playbook', name: 'playbook-settings', component: PlaybookSettingsView },
  { path: '/cloud-sync', name: 'cloud-sync', component: CloudSyncView }
]

// Hash history keeps this deployable to any static file host (including
// plain S3/GitHub Pages buckets) with zero server-side rewrite rules.
const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 }
  }
})

// Every page but the login page needs a signed-in Google account; anyone
// else is sent to /login and brought back to where they were headed after.
// beforeEach runs before every page change. Returning true allows it;
// returning a route (or path) sends the person there instead.
router.beforeEach((targetRoute) => {
  const { signedIn } = useCloudSyncStore()
  if (targetRoute.meta.public) {
    // Already signed in? Skip the login page and go where they were headed.
    return signedIn.value && targetRoute.name === 'login' ? (targetRoute.query.redirect || '/') : true
  }
  if (!signedIn.value) {
    return { name: 'login', query: targetRoute.fullPath === '/' ? {} : { redirect: targetRoute.fullPath } }
  }
  return true
})

export default router
