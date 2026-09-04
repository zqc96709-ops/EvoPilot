import { assertProtocolCompatible, type SyncChange, type SyncConflict, type SyncMutation } from './protocol'

export type SyncReplica = {
  pending(limit: number): Promise<SyncMutation[]>
  acknowledge(ids: string[], cursor: number): Promise<void>
  cursor(): Promise<number>
  apply(changes: SyncChange[], cursor: number): Promise<void>
  saveConflict(conflict: SyncConflict): Promise<void>
}

export type SyncTransport = {
  health(): Promise<{ protocolVersion: number; minSupportedVersion: number }>
  push(mutations: SyncMutation[]): Promise<{ results: Array<{ mutationId: string; status: string; serverSequence?: number; serverRevision?: number; conflictId?: string; fields?: string[]; remotePayload?: Record<string, unknown> }> }>
  pull(cursor: number): Promise<{ changes: SyncChange[]; nextCursor: number }>
}

export const synchronize = async (replica: SyncReplica, transport: SyncTransport) => {
  assertProtocolCompatible(await transport.health())
  const mutations = await replica.pending(100)
  let pushed = 0
  let conflicts = 0
  let cursor = await replica.cursor()
  if (mutations.length) {
    const response = await transport.push(mutations)
    const acknowledged: string[] = []
    for (const result of response.results) {
      if (result.status === 'APPLIED' || result.status === 'NOT_FOUND') {
        acknowledged.push(result.mutationId)
        pushed += 1
        cursor = Math.max(cursor, result.serverSequence || 0)
      } else if (result.status === 'CONFLICT') {
        const mutation = mutations.find((item) => item.mutationId === result.mutationId)!
        await replica.saveConflict({ conflictId: result.conflictId!, entityType: mutation.entityType, entityId: mutation.entityId, localRevision: mutation.baseRevision, serverRevision: result.serverRevision || 0, fields: result.fields || [], localPayload: mutation.payload, remotePayload: result.remotePayload || {} })
        acknowledged.push(result.mutationId)
        conflicts += 1
      }
    }
    await replica.acknowledge(acknowledged, cursor)
  }
  const pulled = await transport.pull(await replica.cursor())
  await replica.apply(pulled.changes, pulled.nextCursor)
  return { pushed, pulled: pulled.changes.length, conflicts, cursor: pulled.nextCursor }
}

export const httpSyncTransport = (baseUrl: string, token: string, workspaceId = 'local'): SyncTransport => {
  const request = async <T>(path: string, init?: RequestInit) => {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init?.headers || {}) } })
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `SYNC_HTTP_${response.status}`)
    return response.json() as Promise<T>
  }
  return {
    health: () => request('/health'),
    push: (mutations) => request('/sync/push', { method: 'POST', body: JSON.stringify({ mutations }) }),
    pull: (cursor) => request(`/sync/pull?workspaceId=${encodeURIComponent(workspaceId)}&cursor=${cursor}`),
  }
}
