import { afterEach, describe, expect, it } from 'vitest'
import { createSyncServer, openSyncDatabase, pushMutations } from './server.mjs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const mutation = (id: string, fields: string[], payload: Record<string, unknown>, baseRevision = 0) => ({ mutationId: id, workspaceId: 'local', deviceId: 'mac', entityType: 'tasks', entityId: 'task-a', operation: baseRevision ? 'UPDATE' : 'CREATE', baseRevision, changedFields: fields, payload, protocolVersion: 1, createdAt: new Date().toISOString() })

describe('local sync server', () => {
  let server: ReturnType<typeof createSyncServer> | undefined
  afterEach(() => server?.close())

  it('is idempotent and merges disjoint offline fields', () => {
    const db = openSyncDatabase()
    const first = mutation('m1', ['title', 'priority'], { id: 'task-a', title: 'old', priority: 'LOW' })
    expect(pushMutations(db, [first, first]).map((item) => item.serverRevision)).toEqual([1, 1])
    expect(pushMutations(db, [mutation('m2', ['title'], { title: 'Mac' }, 1)])[0].status).toBe('APPLIED')
    expect(pushMutations(db, [mutation('m3', ['priority'], { priority: 'HIGH' }, 1)])[0].status).toBe('APPLIED')
    const snapshot = db.prepare('SELECT payload_json FROM records').get() as { payload_json: string }
    expect(JSON.parse(snapshot.payload_json)).toMatchObject({ title: 'Mac', priority: 'HIGH' })
  })

  it('keeps note content and category ownership through a disjoint merge, but conflicts on the same category field', () => {
    const db = openSyncDatabase()
    const note = (mutationId: string, deviceId: string, fields: string[], payload: Record<string, unknown>, baseRevision = 0) => ({ mutationId, workspaceId: 'local', deviceId, entityType: 'notes', entityId: 'note-category-a', operation: baseRevision ? 'UPDATE' : 'CREATE', baseRevision, changedFields: fields, payload, protocolVersion: 1, createdAt: new Date().toISOString() })
    pushMutations(db, [note('create', 'mac', ['content', 'notebookCategoryId'], { id: 'note-category-a', content: '初始正文' })])
    expect(pushMutations(db, [note('mac-content', 'mac', ['content'], { content: 'Mac 正文' }, 1)])[0].status).toBe('APPLIED')
    expect(pushMutations(db, [note('web-category', 'web', ['notebookCategoryId'], { notebookCategoryId: 'category-a' }, 1)])[0].status).toBe('APPLIED')
    const merged = JSON.parse((db.prepare('SELECT payload_json FROM records WHERE entity_id=?').get('note-category-a') as { payload_json: string }).payload_json)
    expect(merged).toMatchObject({ content: 'Mac 正文', notebookCategoryId: 'category-a' })
    expect(pushMutations(db, [note('mac-category', 'mac', ['notebookCategoryId'], { notebookCategoryId: 'category-b' }, 3)])[0].status).toBe('APPLIED')
    expect(pushMutations(db, [note('web-category-conflict', 'web', ['notebookCategoryId'], { notebookCategoryId: 'category-c' }, 3)])[0]).toMatchObject({ status: 'CONFLICT', fields: ['notebookCategoryId'] })
  })

  it('records same-field conflicts and tombstones prevent resurrection', () => {
    const db = openSyncDatabase()
    pushMutations(db, [mutation('m1', ['title'], { id: 'task-a', title: 'old' })])
    pushMutations(db, [mutation('m2', ['title'], { title: 'Mac' }, 1)])
    expect(pushMutations(db, [mutation('m3', ['title'], { title: 'Web' }, 1)])[0].status).toBe('CONFLICT')
    const deletion = { ...mutation('m4', ['deletedAt'], { deletedAt: 'now' }, 1), operation: 'DELETE' }
    expect(pushMutations(db, [deletion])[0].status).toBe('APPLIED')
    expect(JSON.parse((db.prepare('SELECT payload_json FROM records').get() as { payload_json: string }).payload_json).deletedAt).toBe('now')
  })

  it('serves authenticated snapshot and incremental pull over real HTTP', async () => {
    const db = openSyncDatabase()
    pushMutations(db, [mutation('m1', ['title'], { id: 'task-a', title: 'A' })])
    server = createSyncServer({ db, token: 'test' })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address')
    const headers = { authorization: 'Bearer test' }
    const snapshot = await fetch(`http://127.0.0.1:${address.port}/sync/snapshot`, { headers }).then((response) => response.json())
    const pull = await fetch(`http://127.0.0.1:${address.port}/sync/pull?cursor=0`, { headers }).then((response) => response.json())
    expect(snapshot.records).toHaveLength(1)
    expect(pull.changes).toHaveLength(1)
  })

  it.each(['notes', 'decisions'])('preserves both %s edits and converges after manual resolution', async (entityType) => {
    const db = openSyncDatabase(); const make = (mutationId: string, deviceId: string, baseRevision: number, body: string) => ({ mutationId, workspaceId: 'local', deviceId, entityType, entityId: `${entityType}-a`, operation: baseRevision ? 'UPDATE' : 'CREATE', baseRevision, changedFields: ['body'], payload: { id: `${entityType}-a`, body }, protocolVersion: 1, createdAt: new Date().toISOString() })
    pushMutations(db, [make(`${entityType}-create`, 'mac', 0, 'base')])
    expect(pushMutations(db, [make(`${entityType}-a`, 'mac', 1, 'A')])[0].status).toBe('APPLIED')
    const conflict = pushMutations(db, [make(`${entityType}-b`, 'web', 1, 'B')])[0]
    expect(conflict).toMatchObject({ status: 'CONFLICT', remotePayload: { body: 'A' } })
    expect(JSON.parse((db.prepare('SELECT local_payload_json FROM conflicts').get() as { local_payload_json: string }).local_payload_json).body).toBe('B')
    server = createSyncServer({ db, token: 'test' }); await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address')
    const root = `http://127.0.0.1:${address.port}`; const headers = { authorization: 'Bearer test', 'content-type': 'application/json' }
    const resolved = await fetch(`${root}/conflicts/${conflict.conflictId}/resolve`, { method: 'POST', headers, body: JSON.stringify({ resolution: 'MERGE', payload: { body: 'A\nB' } }) }).then((response) => response.json())
    expect(resolved).toMatchObject({ ok: true, serverRevision: 3, payload: { body: 'A\nB' } })
    const pulled = await fetch(`${root}/sync/pull?cursor=2`, { headers }).then((response) => response.json())
    expect(pulled.changes.at(-1)).toMatchObject({ serverRevision: 3, payload: { body: 'A\nB' } })
    server.close(); server = undefined
  })

  it('resumes chunk uploads and verifies sha256 before making files available', async () => {
    const objectDir = mkdtempSync(join(tmpdir(), 'jason-sync-files-'))
    const bytes = Buffer.from('Jason OS file sync')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    server = createSyncServer({ db: openSyncDatabase(), token: 'test', objectDir })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address')
    const root = `http://127.0.0.1:${address.port}`; const headers = { authorization: 'Bearer test' }
    const started = await fetch(`${root}/files/init`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: 'local', sha256, size: bytes.length, mimeType: 'text/plain' }) }).then((response) => response.json())
    const halfway = Math.floor(bytes.length / 2)
    await fetch(`${root}/files/chunk/${started.uploadId}?offset=0`, { method: 'PUT', headers, body: bytes.subarray(0, halfway) })
    await fetch(`${root}/files/chunk/${started.uploadId}?offset=${halfway}`, { method: 'PUT', headers, body: bytes.subarray(halfway) })
    const completed = await fetch(`${root}/files/complete/${started.uploadId}`, { method: 'POST', headers }).then((response) => response.json())
    const downloaded = Buffer.from(await fetch(`${root}/files/object/${sha256}`, { headers }).then((response) => response.arrayBuffer()))
    expect(completed.state).toBe('AVAILABLE'); expect(downloaded.equals(bytes)).toBe(true)
    server.close(); server = undefined; rmSync(objectDir, { recursive: true, force: true })
  })

  it('resumes upload and ranged download after a server interruption without duplicates', async () => {
    const objectDir = mkdtempSync(join(tmpdir(), 'jason-sync-failure-')); const dbPath = join(objectDir, 'sync.sqlite3')
    const bytes = Buffer.alloc(1024 * 32, 7); const sha256 = createHash('sha256').update(bytes).digest('hex'); const headers = { authorization: 'Bearer test' }
    const listen = async () => { server = createSyncServer({ db: openSyncDatabase(dbPath), token: 'test', objectDir }); await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address'); return `http://127.0.0.1:${address.port}` }
    let root = await listen(); const started = await fetch(`${root}/files/init`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ sha256, size: bytes.length }) }).then((response) => response.json())
    const split = Math.floor(bytes.length * 0.3); await fetch(`${root}/files/chunk/${started.uploadId}?offset=0`, { method: 'PUT', headers, body: bytes.subarray(0, split) })
    await new Promise<void>((resolve) => server!.close(() => resolve())); server = undefined; root = await listen()
    await fetch(`${root}/files/chunk/${started.uploadId}?offset=${split}`, { method: 'PUT', headers, body: bytes.subarray(split) })
    expect((await fetch(`${root}/files/complete/${started.uploadId}`, { method: 'POST', headers }).then((response) => response.json())).state).toBe('AVAILABLE')
    const first = Buffer.from(await fetch(`${root}/files/object/${sha256}`, { headers: { ...headers, range: `bytes=0-${split - 1}` } }).then((response) => response.arrayBuffer()))
    await new Promise<void>((resolve) => server!.close(() => resolve())); server = undefined; root = await listen()
    const second = Buffer.from(await fetch(`${root}/files/object/${sha256}`, { headers: { ...headers, range: `bytes=${split}-${bytes.length - 1}` } }).then((response) => response.arrayBuffer()))
    expect(Buffer.concat([first, second]).equals(bytes)).toBe(true)
    expect((openSyncDatabase(dbPath).prepare('SELECT count(*) AS count FROM file_assets').get() as { count: number }).count).toBe(1)
    server.close(); server = undefined; rmSync(objectDir, { recursive: true, force: true })
  })

  it('enforces online timer leases and reports expired cursors', async () => {
    const db = openSyncDatabase()
    pushMutations(db, [mutation('m1', ['title'], { id: 'task-a', title: 'A' }), { ...mutation('m2', ['title'], { id: 'task-b', title: 'B' }), entityId: 'task-b' }, { ...mutation('m3', ['title'], { id: 'task-c', title: 'C' }), entityId: 'task-c' }])
    db.prepare('DELETE FROM changes WHERE server_sequence<=2').run()
    const objectDir = mkdtempSync(join(tmpdir(), 'jason-sync-lease-'))
    server = createSyncServer({ db, token: 'test', objectDir }); await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address')
    const root = `http://127.0.0.1:${address.port}`; const headers = { authorization: 'Bearer test', 'content-type': 'application/json' }
    const first = await fetch(`${root}/timers/lease`, { method: 'POST', headers, body: JSON.stringify({ deviceId: 'mac', sessionId: 's1' }) })
    const second = await fetch(`${root}/timers/lease`, { method: 'POST', headers, body: JSON.stringify({ deviceId: 'ios', sessionId: 's2' }) })
    const expired = await fetch(`${root}/sync/pull?cursor=1`, { headers })
    expect(first.status).toBe(200); expect(second.status).toBe(409); expect(expired.status).toBe(410)
    server.close(); server = undefined; rmSync(objectDir, { recursive: true, force: true })
  })

  it.each(['decisions', 'reviews', 'principles'])('requires manual resolution for concurrent %s core edits', (entityType) => {
    const db = openSyncDatabase(); const make = (id: string, baseRevision: number, value: string) => ({ mutationId: id, workspaceId: 'local', deviceId: id, entityType, entityId: `${entityType}-core`, operation: baseRevision ? 'UPDATE' : 'CREATE', baseRevision, changedFields: ['content'], payload: { id: `${entityType}-core`, content: value }, protocolVersion: 1, createdAt: new Date().toISOString() })
    pushMutations(db, [make('create', 0, 'base')]); pushMutations(db, [make('mac', 1, 'A')])
    expect(pushMutations(db, [make('web', 1, 'B')])[0]).toMatchObject({ status: 'CONFLICT', fields: ['content'] })
  })

  it('uses set semantics for relations and remove-wins against stale adds', () => {
    const db = openSyncDatabase(); const relation = (mutationId: string, entityId: string, operation: string, baseRevision = 0) => ({ mutationId, workspaceId: 'local', deviceId: mutationId, entityType: 'relations', entityId, operation, baseRevision, changedFields: ['fromId', 'toId'], payload: { id: entityId, fromId: 'a', toId: entityId }, protocolVersion: 1, createdAt: new Date().toISOString() })
    expect(pushMutations(db, [relation('a', 'rel-a', 'RELATION_ADD'), relation('b', 'rel-b', 'RELATION_ADD')]).every((x) => x.status === 'APPLIED')).toBe(true)
    expect(pushMutations(db, [relation('remove', 'rel-a', 'RELATION_REMOVE', 1)])[0].status).toBe('APPLIED')
    expect(pushMutations(db, [relation('stale-add', 'rel-a', 'RELATION_ADD', 1)])[0]).toMatchObject({ status: 'CONFLICT', fields: ['deletedAt'] })
  })

  it('prevents stale updates from resurrecting a deleted task', () => {
    const db = openSyncDatabase(); pushMutations(db, [mutation('create', ['title'], { id: 'task-a', title: 'A' })])
    pushMutations(db, [{ ...mutation('delete', ['deletedAt'], { deletedAt: '2026-09-04T00:00:00Z' }, 1), operation: 'DELETE' }])
    expect(pushMutations(db, [mutation('stale', ['title'], { title: 'resurrected' }, 1)])[0]).toMatchObject({ status: 'CONFLICT', fields: ['deletedAt'] })
    expect((db.prepare('SELECT deleted_at FROM records').get() as { deleted_at: string }).deleted_at).toBeTruthy()
  })

  it('detects offline timer overlap and accepts an adjusted interval', async () => {
    const db = openSyncDatabase(); const timer = (mutationId: string, entityId: string, startedAt: string, endedAt: string) => ({ mutationId, workspaceId: 'local', deviceId: entityId, entityType: 'timeLogs', entityId, operation: 'CREATE', baseRevision: 0, changedFields: ['startedAt', 'endedAt'], payload: { id: entityId, startedAt, endedAt }, protocolVersion: 1, createdAt: new Date().toISOString() })
    expect(pushMutations(db, [timer('timer-a', 'time-a', '2026-09-04T09:00:00Z', '2026-09-04T10:00:00Z')])[0].status).toBe('APPLIED')
    const conflict = pushMutations(db, [timer('timer-b', 'time-b', '2026-09-04T09:30:00Z', '2026-09-04T10:30:00Z')])[0]
    expect(conflict).toMatchObject({ status: 'CONFLICT', fields: ['timeRange'] })
    server = createSyncServer({ db, token: 'test' }); await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address')
    const resolved = await fetch(`http://127.0.0.1:${address.port}/conflicts/${conflict.conflictId}/resolve`, { method: 'POST', headers: { authorization: 'Bearer test', 'content-type': 'application/json' }, body: JSON.stringify({ resolution: 'MERGE', payload: { id: 'time-b', startedAt: '2026-09-04T10:00:00Z', endedAt: '2026-09-04T10:30:00Z' } }) }).then((response) => response.json())
    expect(resolved).toMatchObject({ ok: true, payload: { startedAt: '2026-09-04T10:00:00Z' } })
    expect(db.prepare("SELECT count(*) AS count FROM records WHERE entity_type='timeLogs'").get().count).toBe(2)
    server.close(); server = undefined
  })
  it.each([
    ['KEEP_A', 1, false],
    ['KEEP_B', 1, false],
    ['KEEP_BOTH_WITH_WARNING', 2, true],
    ['ADJUST', 2, false],
  ])('resolves timer overlap with %s without double counting', async (resolution, activeCount, excluded) => {
    const db = openSyncDatabase(); const timer = (mutationId: string, entityId: string, startedAt: string, endedAt: string) => ({ mutationId, workspaceId: 'local', deviceId: entityId, entityType: 'timeLogs', entityId, operation: 'CREATE', baseRevision: 0, changedFields: ['startedAt', 'endedAt'], payload: { id: entityId, startedAt, endedAt }, protocolVersion: 1, createdAt: new Date().toISOString() })
    pushMutations(db, [timer('a', 'time-a', '2026-09-04T09:00:00Z', '2026-09-04T10:00:00Z')])
    const conflict = pushMutations(db, [timer('b', 'time-b', '2026-09-04T09:30:00Z', '2026-09-04T10:30:00Z')])[0]
    server = createSyncServer({ db, token: 'test' }); await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address')
    const payload = resolution === 'ADJUST' ? { startedAt: '2026-09-04T10:00:00Z', endedAt: '2026-09-04T10:30:00Z' } : undefined
    const response = await fetch(`http://127.0.0.1:${address.port}/conflicts/${conflict.conflictId}/resolve`, { method: 'POST', headers: { authorization: 'Bearer test', 'content-type': 'application/json' }, body: JSON.stringify({ resolution, payload }) })
    expect(response.status).toBe(200)
    const rows = db.prepare("SELECT payload_json FROM records WHERE entity_type='timeLogs' AND deleted_at IS NULL").all() as Array<{ payload_json: string }>
    expect(rows).toHaveLength(activeCount as number)
    expect(rows.some((row) => JSON.parse(row.payload_json).excludedFromTotals === true)).toBe(excluded)
    server.close(); server = undefined
  })

})
