import type { JsonValue } from '../domain/types'

export interface Snapshot { document: Record<string, JsonValue>; revision: string }
export interface CommitRequest { document: Record<string, JsonValue>; baseRevision: string; message: string; operationId: string }
export type SaveResult = { ok: true; revision: string } | { ok: false; kind: 'conflict' | 'network' | 'authorization' | 'rate-limit' | 'invalid-data'; message: string }
export interface NotesRepository { load(): Promise<Snapshot>; commit(request: CommitRequest): Promise<SaveResult> }

export class MemoryRepository implements NotesRepository {
  private revision = '0'
  constructor(private document: Record<string, JsonValue>) {}
  async load(): Promise<Snapshot> { return { document: structuredClone(this.document), revision: this.revision } }
  async commit(request: CommitRequest): Promise<SaveResult> {
    if (request.baseRevision !== this.revision) return { ok: false, kind: 'conflict', message: 'The document changed on another device.' }
    this.document = structuredClone(request.document); this.revision = String(Number(this.revision) + 1); return { ok: true, revision: this.revision }
  }
}
