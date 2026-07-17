import assert from 'node:assert/strict'
import { fallbackTagsForBookmark } from '../lib/semantic-tagger'
import { fallbackNotebook, extractTldr } from '../lib/notebook'

const tags = fallbackTagsForBookmark({
  title: "This 284B Model Shouldn't Fit On Your Laptop. It Does",
  text: 'DeepSeek V4 Flash runs on 128GB unified memory with local inference optimizations.',
  body: 'The video explains local AI inference, memory pressure, and quantization tradeoffs for a large DeepSeek model.',
  entities: JSON.stringify({ people: [], organizations: ['DeepSeek'], tools: ['V4 Flash'], concepts: ['local inference', 'quantization'] }),
  imageTags: null,
})

assert(tags.includes('deepseek'))
assert(tags.some(tag => tag.includes('local')))
assert(!tags.includes('youtube'))
assert(tags.length > 0)

const notebook = fallbackNotebook({
  id: 'card-1',
  title: 'AI Cost Saving Tips',
  text: 'AI in SecOps gets expensive because security data is huge, repetitive, and constant.',
  body: 'AI in SecOps gets expensive because security data is huge, repetitive, and constant. Teams can reduce spend by caching repeated work, routing simpler tasks to smaller models, and measuring inference cost.',
})

assert(notebook.startsWith('## TL;DR'))
assert.match(notebook, /## Key points/)
assert.match(extractTldr(notebook), /SecOps/)
assert(!tags.some(tag => tag.endsWith('.')))

console.log('local AI fallbacks ok')
