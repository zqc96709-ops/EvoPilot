import { afterEach, describe, expect, it } from 'vitest'
import { createSyncServer, openSyncDatabase } from './server.mjs'

describe('Mac Web iOS protocol convergence over real HTTP', () => {
  let server: ReturnType<typeof createSyncServer> | undefined
  afterEach(() => server?.close())

  it('converges disjoint offline edits, relation and tombstone without resurrection', async () => {
    server = createSyncServer({ db: openSyncDatabase(), token: 'e2e' })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address')
    const root = `http://127.0.0.1:${address.port}`; const headers = { authorization: 'Bearer e2e', 'content-type': 'application/json' }
    let sequence = 0
    const push = async (mutations: unknown[]) => fetch(`${root}/sync/push`, { method: 'POST', headers, body: JSON.stringify({ mutations }) }).then((response) => response.json())
    const pull = async () => { const result = await fetch(`${root}/sync/pull?cursor=${sequence}`, { headers }).then((response) => response.json()); sequence = result.nextCursor; return result }
    const make = (mutationId: string, deviceId: string, operation: string, baseRevision: number, changedFields: string[], payload: Record<string, unknown>, entityType = 'tasks', entityId = 'task-a') => ({ mutationId, workspaceId: 'local', deviceId, entityType, entityId, operation, baseRevision, changedFields, payload, protocolVersion: 1, createdAt: new Date().toISOString() })

    expect((await push([make('mac-create', 'mac', 'CREATE', 0, ['title', 'priority'], { id: 'task-a', title: 'Task A', priority: 'LOW' })])).results[0].serverRevision).toBe(1)
    expect((await pull()).changes[0].payload.title).toBe('Task A')
    expect((await push([make('web-priority', 'web', 'UPDATE', 1, ['priority'], { priority: 'MEDIUM' })])).results[0].serverRevision).toBe(2)
    await pull()
    expect((await push([make('mac-offline-title', 'mac', 'UPDATE', 2, ['title'], { title: 'Mac offline title' })])).results[0].status).toBe('APPLIED')
    expect((await push([make('ios-offline-priority', 'ios', 'UPDATE', 2, ['priority'], { priority: 'HIGH' })])).results[0].status).toBe('APPLIED')
    const relation = make('web-relation', 'web', 'RELATION_ADD', 0, ['fromId', 'toId', 'relationType'], { id: 'rel-1', fromId: 'task-a', toId: 'project-a', relationType: 'manual' }, 'relations', 'rel-1')
    expect((await push([relation])).results[0].status).toBe('APPLIED')
    const snapshot = await fetch(`${root}/sync/snapshot`, { headers }).then((response) => response.json())
    expect(snapshot.records.find((item: { entityType: string }) => item.entityType === 'tasks').payload).toMatchObject({ title: 'Mac offline title', priority: 'HIGH' })
    expect(snapshot.records.find((item: { entityType: string }) => item.entityType === 'relations')).toBeTruthy()
    expect((await push([make('ios-delete', 'ios', 'DELETE', 4, ['deletedAt'], { deletedAt: '2026-09-04T00:00:00Z' })])).results[0].status).toBe('APPLIED')
    expect((await push([make('stale-resurrection', 'web', 'UPDATE', 2, ['title'], { title: 'stale' })])).results[0].status).toBe('CONFLICT')
    const finalSnapshot = await fetch(`${root}/sync/snapshot`, { headers }).then((response) => response.json())
    expect(finalSnapshot.records.find((item: { entityType: string }) => item.entityType === 'tasks').payload.deletedAt).toBeTruthy()
  })
})
