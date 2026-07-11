import { DomainError, type JsonPath, type JsonValue, isObject } from './types'

export const encodePointer = (path: JsonPath): string => path.length ? `/${path.map(s => String(s).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}` : ''
export const decodePointer = (pointer: string): string[] => {
  if (pointer === '') return []
  if (!pointer.startsWith('/')) throw new DomainError('invalid-path', 'A JSON Pointer must be empty or start with /.')
  return pointer.slice(1).split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'))
}

export function getAt(root: JsonValue, path: JsonPath): JsonValue {
  let node = root
  for (const segment of path) {
    if (Array.isArray(node) && typeof segment === 'number' && segment >= 0 && segment < node.length) node = node[segment]
    else if (isObject(node) && typeof segment === 'string' && Object.hasOwn(node, segment)) node = node[segment]
    else throw new DomainError('invalid-path', `Path does not exist: ${encodePointer(path) || '/'}`)
  }
  return node
}

export const pathStartsWith = (path: JsonPath, prefix: JsonPath) => prefix.length <= path.length && prefix.every((part, index) => part === path[index])
