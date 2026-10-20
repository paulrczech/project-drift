// Tone.js is large and only needed once a drift starts, so the player loads on demand —
// and, with the samples, is fetched ahead of time as soon as someone chooses a first stop.

import { preloadVoice, voiceFromLocation } from '../engine/voices'

export const loadPlayer = () => import('../components/GenerativePlayer.vue')

export function warmUp() {
  loadPlayer()
  preloadVoice(voiceFromLocation())
}
