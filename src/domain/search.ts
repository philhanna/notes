import { encodePointer } from './path'
import { isObject, type JsonPath, type JsonValue } from './types'

export interface SearchResult { path: JsonPath; pointer: string; label: string; type: string }
export function search(root: JsonValue, query: string): SearchResult[] {
  const needle = query.trim().toLocaleLowerCase(); if (!needle) return []
  const results: SearchResult[] = []
  const visit = (value: JsonValue, path: JsonPath) => {
    const label = String(path.at(-1) ?? 'root'); const scalar = isObject(value) || Array.isArray(value) ? '' : String(value)
    if (`${path.join(' ')} ${scalar}`.toLocaleLowerCase().includes(needle)) results.push({ path, pointer: encodePointer(path) || '/', label, type: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value })
    if (Array.isArray(value)) value.forEach((child, index) => visit(child, [...path, index]))
    else if (isObject(value)) Object.entries(value).forEach(([key, child]) => visit(child, [...path, key]))
  }
  visit(root, []); return results
}
