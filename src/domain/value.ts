import type { JsonValue } from './types'

export function parseInput(input: string): JsonValue {
  const trimmed = input.trim()
  if (!trimmed) return input
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed === null || ['string', 'number', 'boolean'].includes(typeof parsed) || Array.isArray(parsed) || typeof parsed === 'object') return parsed as JsonValue
  } catch { /* ordinary unquoted text is a string */ }
  return input
}

export function parseDocument(text: string): Record<string, JsonValue> {
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('The root document must be an object.')
  validate(value as JsonValue)
  return value as Record<string, JsonValue>
}

export function validate(value: JsonValue): void {
  if (Array.isArray(value)) value.forEach(validate)
  else if (typeof value === 'object' && value !== null) {
    const seen = new Set<string>()
    for (const [key, child] of Object.entries(value)) {
      if (!key) throw new TypeError('Object keys cannot be empty.')
      const folded = key.toLocaleLowerCase()
      if (seen.has(folded)) throw new TypeError(`Duplicate object key ignoring case: ${key}`)
      seen.add(folded); validate(child)
    }
  } else if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('JSON numbers must be finite.')
}

export const serialize = (value: JsonValue): string => `${JSON.stringify(value, null, 2)}\n`
