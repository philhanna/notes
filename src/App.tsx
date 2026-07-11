import { useMemo, useState } from 'react'
import { demoDocument } from './app/demo'
import { add, remove, rename, reorder, replace } from './domain/tree'
import { getAt } from './domain/path'
import { parseInput } from './domain/value'
import { isObject, valueType, type JsonPath, type JsonValue } from './domain/types'
import { search } from './domain/search'
import './styles.css'

const displayValue = (value: JsonValue) => typeof value === 'string' ? value : JSON.stringify(value)

export default function App() {
  const [document, setDocument] = useState<JsonValue>(demoDocument)
  const [path, setPath] = useState<JsonPath>([])
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState<'add' | 'edit' | 'rename' | null>(null)
  const [selected, setSelected] = useState<string | number | null>(null)
  const [key, setKey] = useState(''); const [input, setInput] = useState(''); const [error, setError] = useState('')
  const node = getAt(document, path)
  const children = Array.isArray(node) ? node.map((value, index) => [index, value] as const) : isObject(node) ? Object.entries(node) : []
  const results = useMemo(() => search(document, query), [document, query])
  const open = (kind: typeof dialog, segment: string | number | null = null) => {
    setDialog(kind); setSelected(segment); setError(''); setKey(typeof segment === 'string' ? segment : '')
    setInput(segment === null ? '' : displayValue(getAt(document, [...path, segment])))
  }
  const close = () => { setDialog(null); setError('') }
  const save = () => {
    try {
      if (dialog === 'add') setDocument(add(document, path, parseInput(input), Array.isArray(node) ? undefined : key))
      if (dialog === 'edit' && selected !== null) {
        const value = parseInput(input); let next: JsonValue
        try { next = replace(document, [...path, selected], value) } catch (e) {
          if (e instanceof Error && e.message.includes('requires confirmation') && window.confirm(e.message)) next = replace(document, [...path, selected], value, true); else throw e
        }
        setDocument(next)
      }
      if (dialog === 'rename' && selected !== null) setDocument(rename(document, [...path, selected], key))
      close()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save.') }
  }
  const deleteChild = (segment: string | number) => {
    if (window.confirm(`Move ${String(segment)} to trash?`)) setDocument(remove(document, [...path, segment]).document)
  }
  const moveArray = (from: number, delta: number) => setDocument(reorder(document, path, from, from + delta))
  const go = (next: JsonPath) => { setPath(next); setQuery(''); setDialog(null) }

  return <div className="app">
    <header><div><span className="eyebrow">PRIVATE WORKING MEMORY</span><h1>Remember</h1></div><div className="status"><span /> Local draft</div></header>
    <main>
      <nav aria-label="Breadcrumb" className="crumbs"><button onClick={() => go([])}>Home</button>{path.map((segment, index) => <span key={index}> / <button onClick={() => go(path.slice(0, index + 1))}>{segment}</button></span>)}</nav>
      <section className="toolbar"><label><span className="sr-only">Search notes</span><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search keys and values…" /></label><button className="primary" onClick={() => open('add')}>+ New entry</button></section>
      {query ? <section><h2>Search results <small>{results.length}</small></h2><div className="rows">{results.map(result => <button className="row result" key={result.pointer} onClick={() => go(result.path.slice(0, -1))}><span className={`icon ${result.type}`}>{result.type === 'object' ? '{}' : result.type === 'array' ? '[]' : 'Aa'}</span><span><strong>{result.label}</strong><small>{result.pointer}</small></span></button>)}</div></section> : <section><h2>{path.length ? String(path.at(-1)) : 'All notes'} <small>{children.length}</small></h2>{!children.length && <div className="empty">This level is empty. Add its first entry.</div>}<div className="rows">{children.map(([segment, value], index) => {
        const container = Array.isArray(value) || isObject(value)
        return <article className="row" key={String(segment)}><button className="entry" onClick={() => container ? go([...path, segment]) : open('edit', segment)}><span className={`icon ${valueType(value)}`}>{Array.isArray(value) ? '[]' : isObject(value) ? '{}' : 'Aa'}</span><span><strong>{segment}</strong><small>{container ? `${Array.isArray(value) ? value.length : Object.keys(value).length} items` : displayValue(value)}</small></span></button><div className="actions">{Array.isArray(node) && <><button aria-label={`Move ${segment} up`} disabled={index === 0} onClick={() => moveArray(index, -1)}>↑</button><button aria-label={`Move ${segment} down`} disabled={index === children.length - 1} onClick={() => moveArray(index, 1)}>↓</button></>}{isObject(node) && <button onClick={() => open('rename', segment)}>Rename</button>}<button onClick={() => deleteChild(segment)}>Delete</button></div></article>
      })}</div></section>}
    </main>
    {dialog && <div className="backdrop" role="presentation"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><h2 id="dialog-title">{dialog === 'add' ? 'New entry' : dialog === 'rename' ? 'Rename entry' : `Edit ${selected}`}</h2>{(dialog === 'add' && isObject(node) || dialog === 'rename') && <label>Key<input autoFocus value={key} onChange={e => setKey(e.target.value)} /></label>}{dialog !== 'rename' && <label>Value<textarea autoFocus={Array.isArray(node) || dialog === 'edit'} rows={6} value={input} onChange={e => setInput(e.target.value)} placeholder="Text or any JSON value"/><small>Inferred type: {valueType(parseInput(input))}</small></label>}{error && <p className="error" role="alert">{error}</p>}<div className="dialog-actions"><button onClick={close}>Cancel</button><button className="primary" onClick={save}>Save</button></div></section></div>}
  </div>
}
