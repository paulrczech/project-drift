import { createApp } from 'vue'
import 'vue-multiselect/dist/vue-multiselect.css'
import './style.css'

// `?ui=field` is the mood-field interface (in progress); the original interface is the
// default until the field is preferred.
const useField = new URLSearchParams(window.location.search).get('ui') === 'field'

async function root() {
  return useField
    ? (await import('./field/FieldApp.vue')).default
    : (await import('./App.vue')).default
}

root().then((App) => createApp(App).mount('#app'))
