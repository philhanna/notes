import { describe, expect, it } from 'vitest'
import { decodePointer, encodePointer, getAt } from './path'
import { parseDocument, parseInput, serialize } from './value'
import { add, copy, move, remove, rename, reorder, replace } from './tree'

describe('paths and values', () => {
  it('round-trips special JSON Pointer segments', () => expect(decodePointer(encodePointer(['a/b', 'x~y']))).toEqual(['a/b', 'x~y']))
  it.each([['123', 123], ['true', true], ['null', null], ['[1, 2]', [1, 2]], ['hello world', 'hello world'], ['"123"', '123'], ['[hello', '[hello']])('infers %s', (input, value) => expect(parseInput(input)).toEqual(value))
  it('serializes deterministically', () => expect(serialize(parseDocument('{"b":2,"a":1}'))).toBe('{\n  "b": 2,\n  "a": 1\n}\n'))
  it('rejects case-insensitive duplicate keys while parsing', () => expect(() => parseDocument('{"Home":1,"home":2}')).toThrow(/Duplicate/))
})

describe('immutable tree operations', () => {
  const root = { Home: { list: [1, 2], note: 'hello' }, Other: {} }
  it('adds without changing the source', () => { const next = add(root, ['Other'], 3, 'New'); expect(getAt(next, ['Other', 'New'])).toBe(3); expect(root.Other).toEqual({}) })
  it('rejects duplicate keys ignoring case', () => expect(() => add(root, [], 1, 'home')).toThrow(/already exists/))
  it('allows case-only rename and preserves entry order', () => expect(Object.keys(rename(root, ['Home'], 'HOME') as Record<string, unknown>)).toEqual(['HOME', 'Other']))
  it('copies recursively', () => { const next = copy(root, ['Home'], ['Other'], 'copy'); expect(getAt(next, ['Other', 'copy', 'note'])).toBe('hello') })
  it('moves a node atomically', () => { const next = move(root, ['Home', 'note'], ['Other'], 'note'); expect(getAt(next, ['Other', 'note'])).toBe('hello'); expect(() => getAt(next, ['Home', 'note'])).toThrow() })
  it('prevents move cycles', () => expect(() => move(root, ['Home'], ['Home', 'list'], 'oops')).toThrow(/descendant/))
  it('requires confirmation for type changes', () => expect(() => replace(root, ['Home', 'note'], {})).toThrow(/confirmation/))
  it('removes recursively and retains the removed value', () => { const result = remove(root, ['Home']); expect(result.removed).toEqual(root.Home); expect(root.Home.note).toBe('hello') })
  it('reorders arrays accessibly', () => expect(getAt(reorder(root, ['Home', 'list'], 0, 1), ['Home', 'list'])).toEqual([2, 1]))
})
