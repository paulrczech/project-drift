// src/data/EmotionConfig.ts

export interface EmotionProfile {
  label: string
  samples: string[]
  snippet: string
}

export const emotionProfiles: EmotionProfile[] = [
  {
    label: 'happy',
    samples: ['happy-1.mp3', 'happy-2.mp3'],
    snippet: 'The sun leaned low with laughter.',
  },
  {
    label: 'joyful',
    samples: ['joyful-1.mp3', 'joyful-2.mp3'],
    snippet: 'The heart blooms without warning.',
  },
  {
    label: 'grateful',
    samples: ['grateful-1.mp3', 'grateful-2.mp3'],
    snippet: 'Each breath is a gift wrapped in quietness.',
  },
  {
    label: 'playful',
    samples: ['playful-1.mp3', 'playful-2.mp3'],
    snippet: 'The breeze skips across the meadow.',
  },
  {
    label: 'cheerful',
    samples: ['cheerful-1.mp3', 'cheerful-2.mp3'],
    snippet: 'Light dances without asking why.',
  },
  {
    label: 'content',
    samples: ['content-1.mp3', 'content-2.mp3'],
    snippet: 'He who knows contentment is already rich.',
  },
  {
    label: 'hopeful',
    samples: ['hopeful-1.mp3', 'hopeful-2.mp3'],
    snippet: 'The seed believes in spring before it arrives.',
  },
  {
    label: 'peaceful',
    samples: ['peaceful-1.mp3', 'peaceful-2.mp3'],
    snippet: 'The river moves by yielding, not striving.',
  },
  {
    label: 'serene',
    samples: ['serene-1.mp3', 'serene-2.mp3'],
    snippet: 'Stillness reveals the dance beneath all things.',
  },
  {
    label: 'relaxed',
    samples: ['relaxed-1.mp3', 'relaxed-2.mp3'],
    snippet: 'The soft overcomes the hard by its nature.',
  },
  {
    label: 'neutral',
    samples: ['neutral-1.mp3', 'neutral-2.mp3'],
    snippet: 'The open sky holds all without judgment.',
  },
  {
    label: 'reflective',
    samples: ['reflective-1.mp3', 'reflective-2.mp3'],
    snippet: 'The sky holds clouds without holding them.',
  },
  {
    label: 'nostalgic',
    samples: ['nostalgic-1.mp3', 'nostalgic-2.mp3'],
    snippet: 'A memory lingers, worn soft by time.',
  },
  {
    label: 'bittersweet',
    samples: ['bittersweet-1.mp3', 'bittersweet-2.mp3'],
    snippet: 'Joy and sorrow are woven from the same thread.',
  },
  {
    label: 'wistful',
    samples: ['wistful-1.mp3', 'wistful-2.mp3'],
    snippet: 'To grasp too tightly is to lose the moment.',
  },
  {
    label: 'longing',
    samples: ['longing-1.mp3', 'longing-2.mp3'],
    snippet: 'The journey unfolds without urging.',
  },
  {
    label: 'uneasy',
    samples: ['uneasy-1.mp3', 'uneasy-2.mp3'],
    snippet: 'The rushing mind sees obstacles that are not there.',
  },
  {
    label: 'anxious',
    samples: ['anxious-1.mp3', 'anxious-2.mp3'],
    snippet: 'The mind runs ahead of the feet.',
  },
  {
    label: 'melancholy',
    samples: ['melancholy-1.mp3', 'melancholy-2.mp3'],
    snippet: 'Empty spaces are part of the fullness.',
  },
  {
    label: 'depressed',
    samples: ['depressed-1.mp3', 'depressed-2.mp3'],
    snippet: 'Those who endure loss are nearer to wholeness.',
  },
  {
    label: 'sad',
    samples: ['sad-1.mp3', 'sad-2.mp3'],
    snippet: 'Even the sky weeps sometimes.',
  },
]
