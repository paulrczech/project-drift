import { createApp } from 'vue'
import 'vue-multiselect/dist/vue-multiselect.css'
import './style.css'

// The mood field is the home page. `?ui=classic` is the original dropdown interface, kept
// for now.
const classic = new URLSearchParams(window.location.search).get('ui') === 'classic'

async function root() {
  return classic
    ? (await import('./App.vue')).default
    : (await import('./field/FieldApp.vue')).default
}

root().then((App) => createApp(App).mount('#app'))
