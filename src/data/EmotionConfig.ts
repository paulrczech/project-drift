// src/data/EmotionConfig.ts

export interface EmotionProfile {
  label: string
  samples: string[]
  background: string
  snippet: string
  tempoHint: 'medium' | 'fast'
}

export const emotionProfiles: EmotionProfile[] = [
  {
    label: 'happy',
    samples: ['happy-1.mp3', 'happy-2.mp3'],
    background: 'bg-happy.jpg',
    snippet: 'The sun leaned low with laughter.',
    tempoHint: 'medium',
  },
  {
    label: 'joyful',
    samples: ['joyful-1.mp3', 'joyful-2.mp3'],
    background: 'bg-joyful.jpg',
    snippet: 'The heart blooms without warning.',
    tempoHint: 'medium',
  },
  {
    label: 'grateful',
    samples: ['grateful-1.mp3', 'grateful-2.mp3'],
    background: 'bg-grateful.jpg',
    snippet: 'Each breath is a gift wrapped in quietness.',
    tempoHint: 'medium',
  },
  {
    label: 'playful',
    samples: ['playful-1.mp3', 'playful-2.mp3'],
    background: 'bg-playful.jpg',
    snippet: 'The breeze skips across the meadow.',
    tempoHint: 'fast',
  },
  {
    label: 'cheerful',
    samples: ['cheerful-1.mp3', 'cheerful-2.mp3'],
    background: 'bg-cheerful.jpg',
    snippet: 'Light dances without asking why.',
    tempoHint: 'medium',
  },
  {
    label: 'content',
    samples: ['content-1.mp3', 'content-2.mp3'],
    background: 'bg-content.jpg',
    snippet: 'He who knows contentment is already rich.',
    tempoHint: 'medium',
  },
  {
    label: 'hopeful',
    samples: ['hopeful-1.mp3', 'hopeful-2.mp3'],
    background: 'bg-hopeful.jpg',
    snippet: 'The seed believes in spring before it arrives.',
    tempoHint: 'medium',
  },
  {
    label: 'peaceful',
    samples: ['peaceful-1.mp3', 'peaceful-2.mp3'],
    background: 'bg-peaceful.jpg',
    snippet: 'The river moves by yielding, not striving.',
    tempoHint: 'fast',
  },
  {
    label: 'serene',
    samples: ['serene-1.mp3', 'serene-2.mp3'],
    background: 'bg-serene.jpg',
    snippet: 'Stillness reveals the dance beneath all things.',
    tempoHint: 'medium',
  },
  {
    label: 'relaxed',
    samples: ['relaxed-1.mp3', 'relaxed-2.mp3'],
    background: 'bg-relaxed.jpg',
    snippet: 'The soft overcomes the hard by its nature.',
    tempoHint: 'medium',
  },
  {
    label: 'neutral',
    samples: ['neutral-1.mp3', 'neutral-2.mp3'],
    background: 'bg-neutral.jpg',
    snippet: 'The open sky holds all without judgment.',
    tempoHint: 'medium',
  },
  {
    label: 'reflective',
    samples: ['reflective-1.mp3', 'reflective-2.mp3'],
    background: 'bg-reflective.jpg',
    snippet: 'The sky holds clouds without holding them.',
    tempoHint: 'medium',
  },
  {
    label: 'nostalgic',
    samples: ['nostalgic-1.mp3', 'nostalgic-2.mp3'],
    background: 'bg-nostalgic.jpg',
    snippet: 'A memory lingers, worn soft by time.',
    tempoHint: 'medium',
  },
  {
    label: 'bittersweet',
    samples: ['bittersweet-1.mp3', 'bittersweet-2.mp3'],
    background: 'bg-bittersweet.jpg',
    snippet: 'Joy and sorrow are woven from the same thread.',
    tempoHint: 'medium',
  },
  {
    label: 'wistful',
    samples: ['wistful-1.mp3', 'wistful-2.mp3'],
    background: 'bg-wistful.jpg',
    snippet: 'To grasp too tightly is to lose the moment.',
    tempoHint: 'medium',
  },
  {
    label: 'longing',
    samples: ['longing-1.mp3', 'longing-2.mp3'],
    background: 'bg-longing.jpg',
    snippet: 'The journey unfolds without urging.',
    tempoHint: 'medium',
  },
  {
    label: 'uneasy',
    samples: ['uneasy-1.mp3', 'uneasy-2.mp3'],
    background: 'bg-uneasy.jpg',
    snippet: 'The rushing mind sees obstacles that are not there.',
    tempoHint: 'medium',
  },
  {
    label: 'anxious',
    samples: ['anxious-1.mp3', 'anxious-2.mp3'],
    background: 'bg-anxious.jpg',
    snippet: 'The mind runs ahead of the feet.',
    tempoHint: 'fast',
  },
  {
    label: 'melancholy',
    samples: ['melancholy-1.mp3', 'melancholy-2.mp3'],
    background: 'bg-melancholy.jpg',
    snippet: 'Empty spaces are part of the fullness.',
    tempoHint: 'medium',
  },
  {
    label: 'depressed',
    samples: ['depressed-1.mp3', 'depressed-2.mp3'],
    background: 'bg-depressed.jpg',
    snippet: 'Those who endure loss are nearer to wholeness.',
    tempoHint: 'medium',
  },
  {
    label: 'sad',
    samples: ['sad-1.mp3', 'sad-2.mp3'],
    background: 'bg-sad.jpg',
    snippet: 'Even the sky weeps sometimes.',
    tempoHint: 'medium',
  },
]
