import { clone, DomainError, isObject, type JsonPath, type JsonValue } from './types'
import { getAt, pathStartsWith } from './path'
import { validate } from './value'

const findKey = (object: Record<string, JsonValue>, key: string) => Object.keys(object).find(candidate => candidate.toLocaleLowerCase() === key.toLocaleLowerCase())
const assertKey = (key: string) => { if (!key) throw new DomainError('invalid-key', 'A key is required.') }

function parentAt(root: JsonValue, path: JsonPath): { parent: JsonValue; segment: string | number } {
  if (!path.length) throw new DomainError('invalid-path', 'The root cannot be changed by this operation.')
  return { parent: getAt(root, path.slice(0, -1)), segment: path.at(-1)! }
}

function insert(parent: JsonValue, value: JsonValue, key?: string): void {
  if (Array.isArray(parent)) { parent.push(value); return }
  if (!isObject(parent)) throw new DomainError('invalid-destination', 'The destination must be an object or array.')
  assertKey(key ?? '')
  if (findKey(parent, key!)) throw new DomainError('duplicate-key', `“${key}” already exists at the destination.`)
  parent[key!] = value
}

export function add(root: JsonValue, parentPath: JsonPath, value: JsonValue, key?: string): JsonValue {
  const next = clone(root); insert(getAt(next, parentPath), clone(value), key); validate(next); return next
}

export function replace(root: JsonValue, path: JsonPath, value: JsonValue, confirmTypeChange = false): JsonValue {
  const current = getAt(root, path)
  const containerKind = (v: JsonValue) => Array.isArray(v) ? 'array' : isObject(v) ? 'object' : 'scalar'
  if (containerKind(current) !== containerKind(value) && !confirmTypeChange) throw new DomainError('confirmation-required', 'Changing between a scalar, object, and array requires confirmation.')
  const next = clone(root); const { parent, segment } = parentAt(next, path)
  if (Array.isArray(parent) && typeof segment === 'number') parent[segment] = clone(value)
  else if (isObject(parent) && typeof segment === 'string') parent[segment] = clone(value)
  else throw new DomainError('invalid-path', 'The path does not match its parent type.')
  validate(next); return next
}

export function rename(root: JsonValue, path: JsonPath, key: string): JsonValue {
  assertKey(key); const next = clone(root); const { parent, segment } = parentAt(next, path)
  if (!isObject(parent) || typeof segment !== 'string') throw new DomainError('invalid-path', 'Only object entries can be renamed.')
  const duplicate = findKey(parent, key)
  if (duplicate && duplicate !== segment) throw new DomainError('duplicate-key', `“${key}” already exists.`)
  const entries = Object.entries(parent); for (const existing of Object.keys(parent)) delete parent[existing]
  for (const [oldKey, value] of entries) parent[oldKey === segment ? key : oldKey] = value
  validate(next); return next
}

export function remove(root: JsonValue, path: JsonPath): { document: JsonValue; removed: JsonValue } {
  const next = clone(root); const { parent, segment } = parentAt(next, path); let removed: JsonValue
  if (Array.isArray(parent) && typeof segment === 'number') { if (segment < 0 || segment >= parent.length) throw new DomainError('invalid-path', 'Array position does not exist.'); removed = parent.splice(segment, 1)[0] }
  else if (isObject(parent) && typeof segment === 'string' && Object.hasOwn(parent, segment)) { removed = parent[segment]; delete parent[segment] }
  else throw new DomainError('invalid-path', 'Path does not exist.')
  return { document: next, removed: clone(removed) }
}

export function copy(root: JsonValue, source: JsonPath, destination: JsonPath, key?: string): JsonValue { return add(root, destination, getAt(root, source), key) }
export function move(root: JsonValue, source: JsonPath, destination: JsonPath, key?: string): JsonValue {
  if (pathStartsWith(destination, source)) throw new DomainError('cycle', 'A container cannot be moved into itself or a descendant.')
  const value = getAt(root, source); const { document } = remove(root, source)
  let adjusted = destination
  const sourceParent = source.slice(0, -1)
  if (sourceParent.length === destination.length && sourceParent.every((v, i) => v === destination[i])) adjusted = sourceParent
  return add(document, adjusted, value, key)
}

export function reorder(root: JsonValue, path: JsonPath, from: number, to: number): JsonValue {
  const next = clone(root); const array = getAt(next, path)
  if (!Array.isArray(array) || from < 0 || to < 0 || from >= array.length || to >= array.length) throw new DomainError('invalid-path', 'Invalid array reorder.')
  const [item] = array.splice(from, 1); array.splice(to, 0, item); return next
}
