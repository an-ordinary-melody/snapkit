import { createLucideIcon } from 'lucide-react'

/** Text recognition (OCR): scan corners around a "T". Drawn like Lucide's own icons. */
export const OcrIcon = createLucideIcon('OcrText', [
  ['path', { d: 'M4 8V6a2 2 0 0 1 2-2h2', key: 'tl' }],
  ['path', { d: 'M16 4h2a2 2 0 0 1 2 2v2', key: 'tr' }],
  ['path', { d: 'M20 16v2a2 2 0 0 1-2 2h-2', key: 'br' }],
  ['path', { d: 'M8 20H6a2 2 0 0 1-2-2v-2', key: 'bl' }],
  ['path', { d: 'M8.5 8.5h7', key: 'tbar' }],
  ['path', { d: 'M12 8.5v7.5', key: 'tstem' }]
])
