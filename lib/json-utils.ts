// Strip fencing/prose around LLM-emitted JSON by slicing from the first
// opening bracket of either kind to the matching closing bracket at the end.
export function extractJson(content: string): string {
  const firstBrace = content.indexOf('{')
  const firstBracket = content.indexOf('[')
  const isObject = firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)
  const start = isObject ? firstBrace : firstBracket
  const endChar = isObject ? '}' : ']'
  const end = content.lastIndexOf(endChar)
  if (start === -1 || end === -1 || end <= start) return content
  return content.slice(start, end + 1)
}
