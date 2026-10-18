// Which composer plays a drift on a voice: the pad's free-time Composer, or the ostinato's
// PulseComposer. Both turn the same harmony into timed notes; only the performance differs.

import { Composer, type Layout, type NoteEvent, type TimelinePlan } from './compose'
import { PulseComposer, TEMPO_FEEL, type TempoFeel } from './pulse'
import type { Voice } from './voices'

export interface Performer {
  readonly layout: Layout
  pull(until: number): NoteEvent[]
}

// The pulse's tempo: an exact BPM, or a feel (slow / medium / fast) applied to the journey's own.
export interface Tempo {
  feel?: TempoFeel
  bpm?: number
}

export function performerFor(
  voice: Voice,
  plan: Omit<TimelinePlan, 'rng'>,
  rng: () => number,
  tempo: Tempo = {}
): Performer {
  const params = { register: voice.register, span: voice.span, ceiling: voice.ceiling, rng }
  if (voice.style === 'pulse')
    return new PulseComposer({ ...plan, ...params, bpm: tempo.bpm, tempoScale: TEMPO_FEEL[tempo.feel ?? 'medium'] })
  return new Composer({
    ...plan,
    ...params,
    attack: voice.attack,
    link: voice.link,
    links: voice.links,
    overlap: voice.overlap,
    maxHold: voice.maxHold,
  })
}
