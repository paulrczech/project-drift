// Which composer plays a drift on a voice: the pad's free-time Composer, or the ostinato's
// PulseComposer. Both turn the same harmony into timed notes; only the performance differs.

import { Composer, type Layout, type NoteEvent, type TimelinePlan } from './compose'
import { PulseComposer, TEMPO_FEEL, type Density, type Grid, type TempoFeel } from './pulse'
import type { Voice } from './voices'

export interface Performer {
  readonly layout: Layout
  pull(until: number): NoteEvent[]
}

// How the pulse is played: its tempo (an exact BPM, or a feel — slow / medium / fast — applied to
// the journey's own), the grid its cell is divided on, and how dense the cell is.
export interface Tempo {
  feel?: TempoFeel
  bpm?: number
  grid?: Grid
  density?: Density
}

export function performerFor(
  voice: Voice,
  plan: Omit<TimelinePlan, 'rng'>,
  rng: () => number,
  tempo: Tempo = {}
): Performer {
  const params = { register: voice.register, span: voice.span, ceiling: voice.ceiling, rng }
  if (voice.style === 'pulse')
    return new PulseComposer({ ...plan, ...params, bpm: tempo.bpm, tempoScale: TEMPO_FEEL[tempo.feel ?? 'medium'], grid: tempo.grid, density: tempo.density })
  return new Composer({
    ...plan,
    ...params,
    bpm: tempo.bpm ?? plan.bpm,
    spread: voice.spread,
    attack: voice.attack,
    link: voice.link,
    links: voice.links,
    overlap: voice.overlap,
    maxHold: voice.maxHold,
  })
}
