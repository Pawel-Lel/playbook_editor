import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './assets/main.css'

// The app's starting point: create the Vue app from the root component
// (App.vue), plug in the router (which page to show for which URL), and
// render it into <div id="app"> in index.html.
createApp(App).use(router).mount('#app')
