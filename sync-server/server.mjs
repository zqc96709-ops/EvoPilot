import { createServer as createHttpServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { conflictPolicyFor } from './conflict-policy.mjs'
import { FileSystemObjectStorage, S3ObjectStorage } from './object-storage.mjs'

export const PROTOCOL_VERSION = 1
export const SERVER_SCHEMA_VERSION = 1
export const MIN_SUPPORTED_VERSION = 1

const json = (response, status, value) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS' })
  response.end(JSON.stringify(value))
}

const body = async (request) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

export const openSyncDatabase = (path = ':memory:') => {
  const db = new DatabaseSync(path)
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS devices(device_id TEXT PRIMARY KEY,name TEXT,platform TEXT,app_version TEXT,schema_version INTEGER,protocol_version INTEGER,last_seen_at TEXT,revoked_at TEXT);
    CREATE TABLE IF NOT EXISTS records(workspace_id TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,payload_json TEXT NOT NULL,revision INTEGER NOT NULL,deleted_at TEXT,PRIMARY KEY(workspace_id,entity_type,entity_id));
    CREATE TABLE IF NOT EXISTS record_revisions(workspace_id TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,revision INTEGER NOT NULL,changed_fields_json TEXT NOT NULL,payload_json TEXT NOT NULL,PRIMARY KEY(workspace_id,entity_type,entity_id,revision));
    CREATE TABLE IF NOT EXISTS processed_mutations(mutation_id TEXT PRIMARY KEY,result_json TEXT NOT NULL,processed_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS changes(server_sequence INTEGER PRIMARY KEY AUTOINCREMENT,workspace_id TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,operation TEXT NOT NULL,revision INTEGER NOT NULL,payload_json TEXT NOT NULL,mutation_id TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS conflicts(conflict_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,local_revision INTEGER NOT NULL,server_revision INTEGER NOT NULL,fields_json TEXT NOT NULL,local_payload_json TEXT NOT NULL,remote_payload_json TEXT NOT NULL,created_at TEXT NOT NULL,resolved_at TEXT,resolution TEXT);
    CREATE TABLE IF NOT EXISTS file_assets(file_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,sha256 TEXT NOT NULL,size INTEGER NOT NULL,mime_type TEXT,object_key TEXT NOT NULL,created_at TEXT NOT NULL,deleted_at TEXT,UNIQUE(workspace_id,sha256));
    CREATE TABLE IF NOT EXISTS file_uploads(upload_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,sha256 TEXT NOT NULL,size INTEGER NOT NULL,mime_type TEXT,temp_path TEXT NOT NULL,received INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS timer_leases(workspace_id TEXT PRIMARY KEY,device_id TEXT NOT NULL,session_id TEXT NOT NULL,started_at TEXT NOT NULL,lease_expires_at TEXT NOT NULL);
  `)
  return db
}

const current = (db, mutation) => db.prepare('SELECT payload_json,revision,deleted_at FROM records WHERE workspace_id=? AND entity_type=? AND entity_id=?').get(mutation.workspaceId, mutation.entityType, mutation.entityId)
const insertChange = (db, mutation, revision, payload) => {
  const info = db.prepare('INSERT INTO changes(workspace_id,entity_type,entity_id,operation,revision,payload_json,mutation_id,created_at) VALUES(?,?,?,?,?,?,?,?)').run(mutation.workspaceId, mutation.entityType, mutation.entityId, mutation.operation, revision, JSON.stringify(payload), mutation.mutationId, new Date().toISOString())
  return Number(info.lastInsertRowid)
}
const timeRange = (payload) => ({ start: Date.parse(payload.startedAt || payload.startAt || ''), end: Date.parse(payload.endedAt || payload.endAt || '') })
const findTimerOverlap = (db, mutation) => {
  if (mutation.entityType !== 'timeLogs' || mutation.operation === 'DELETE') return null
  const candidate = timeRange(mutation.payload); if (!Number.isFinite(candidate.start) || !Number.isFinite(candidate.end)) return null
  return db.prepare("SELECT entity_id,payload_json,revision FROM records WHERE workspace_id=? AND entity_type='timeLogs' AND entity_id<>? AND deleted_at IS NULL").all(mutation.workspaceId, mutation.entityId).find((row) => { const value = timeRange(JSON.parse(row.payload_json)); return candidate.start < value.end && value.start < candidate.end }) || null
}

export const pushMutations = (db, mutations) => {
  const results = []
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const mutation of mutations) {
      if (mutation.protocolVersion !== PROTOCOL_VERSION) throw new Error('UPGRADE_REQUIRED')
      const prior = db.prepare('SELECT result_json FROM processed_mutations WHERE mutation_id=?').get(mutation.mutationId)
      if (prior) { results.push(JSON.parse(prior.result_json)); continue }
      const found = current(db, mutation)
      const policy = conflictPolicyFor(mutation.entityType)
      const timerOverlap = policy === 'DOMAIN_CUSTOM' ? findTimerOverlap(db, mutation) : null
      const remote = found ? JSON.parse(found.payload_json) : null
      let revision = found?.revision || 0
      let result
      if (found?.deleted_at && mutation.operation !== 'DELETE' && mutation.operation !== 'RELATION_REMOVE') {
        const conflictId = randomUUID()
        db.prepare('INSERT INTO conflicts VALUES(?,?,?,?,?,?,?,?,?,?,NULL,NULL)').run(conflictId, mutation.workspaceId, mutation.entityType, mutation.entityId, mutation.baseRevision, revision, '["deletedAt"]', JSON.stringify(mutation.payload), JSON.stringify(remote), new Date().toISOString())
        result = { mutationId: mutation.mutationId, status: 'CONFLICT', conflictId, fields: ['deletedAt'], serverRevision: revision, remotePayload: remote }
      } else if (timerOverlap) {
        const conflictId = randomUUID(); const remotePayload = JSON.parse(timerOverlap.payload_json)
        db.prepare('INSERT INTO conflicts VALUES(?,?,?,?,?,?,?,?,?,?,NULL,NULL)').run(conflictId, mutation.workspaceId, mutation.entityType, mutation.entityId, mutation.baseRevision, timerOverlap.revision, '["timeRange"]', JSON.stringify(mutation.payload), JSON.stringify(remotePayload), new Date().toISOString())
        result = { mutationId: mutation.mutationId, status: 'CONFLICT', conflictId, fields: ['timeRange'], serverRevision: timerOverlap.revision, remotePayload }
      } else if (!found && mutation.operation !== 'CREATE' && mutation.operation !== 'RELATION_ADD') {
        result = { mutationId: mutation.mutationId, status: 'NOT_FOUND' }
      } else if (!found) {
        revision = 1
        db.prepare('INSERT INTO records VALUES(?,?,?,?,?,NULL)').run(mutation.workspaceId, mutation.entityType, mutation.entityId, JSON.stringify(mutation.payload), revision)
        db.prepare('INSERT INTO record_revisions VALUES(?,?,?,?,?,?)').run(mutation.workspaceId, mutation.entityType, mutation.entityId, revision, JSON.stringify(mutation.changedFields || []), JSON.stringify(mutation.payload))
        result = { mutationId: mutation.mutationId, status: 'APPLIED', serverRevision: revision, serverSequence: insertChange(db, mutation, revision, mutation.payload) }
      } else if (policy === 'APPEND_ONLY' && mutation.operation !== 'CREATE') {
        const conflictId = randomUUID()
        db.prepare('INSERT INTO conflicts VALUES(?,?,?,?,?,?,?,?,?,?,NULL,NULL)').run(conflictId, mutation.workspaceId, mutation.entityType, mutation.entityId, mutation.baseRevision, revision, '["appendOnly"]', JSON.stringify(mutation.payload), JSON.stringify(remote), new Date().toISOString())
        result = { mutationId: mutation.mutationId, status: 'CONFLICT', conflictId, fields: ['appendOnly'], serverRevision: revision, remotePayload: remote }
      } else if (mutation.operation === 'DELETE' || mutation.operation === 'RELATION_REMOVE') {
        revision += 1
        const deletedAt = mutation.payload.deletedAt || new Date().toISOString()
        const payload = { ...remote, ...mutation.payload, deletedAt }
        db.prepare('UPDATE records SET payload_json=?,revision=?,deleted_at=? WHERE workspace_id=? AND entity_type=? AND entity_id=?').run(JSON.stringify(payload), revision, deletedAt, mutation.workspaceId, mutation.entityType, mutation.entityId)
        db.prepare('INSERT INTO record_revisions VALUES(?,?,?,?,?,?)').run(mutation.workspaceId, mutation.entityType, mutation.entityId, revision, '["deletedAt"]', JSON.stringify(payload))
        result = { mutationId: mutation.mutationId, status: 'APPLIED', serverRevision: revision, serverSequence: insertChange(db, mutation, revision, payload) }
      } else {
        const serverChanged = mutation.baseRevision < revision
          ? db.prepare('SELECT changed_fields_json FROM record_revisions WHERE workspace_id=? AND entity_type=? AND entity_id=? AND revision>?').all(mutation.workspaceId, mutation.entityType, mutation.entityId, mutation.baseRevision).flatMap((row) => JSON.parse(row.changed_fields_json))
          : []
        const collisions = [...new Set((mutation.changedFields || []).filter((field) => serverChanged.includes(field)))]
        if (collisions.length) {
          const conflictId = randomUUID()
          db.prepare('INSERT INTO conflicts VALUES(?,?,?,?,?,?,?,?,?,?,NULL,NULL)').run(conflictId, mutation.workspaceId, mutation.entityType, mutation.entityId, mutation.baseRevision, revision, JSON.stringify(collisions), JSON.stringify(mutation.payload), JSON.stringify(remote), new Date().toISOString())
          result = { mutationId: mutation.mutationId, status: 'CONFLICT', conflictId, fields: collisions, serverRevision: revision, remotePayload: remote }
        } else {
          revision += 1
          const payload = { ...remote }
          for (const field of mutation.changedFields || Object.keys(mutation.payload)) payload[field] = mutation.payload[field]
          db.prepare('UPDATE records SET payload_json=?,revision=?,deleted_at=NULL WHERE workspace_id=? AND entity_type=? AND entity_id=?').run(JSON.stringify(payload), revision, mutation.workspaceId, mutation.entityType, mutation.entityId)
          db.prepare('INSERT INTO record_revisions VALUES(?,?,?,?,?,?)').run(mutation.workspaceId, mutation.entityType, mutation.entityId, revision, JSON.stringify(mutation.changedFields || []), JSON.stringify(payload))
          result = { mutationId: mutation.mutationId, status: 'APPLIED', serverRevision: revision, serverSequence: insertChange(db, mutation, revision, payload) }
        }
      }
      db.prepare('INSERT INTO processed_mutations VALUES(?,?,?)').run(mutation.mutationId, JSON.stringify(result), new Date().toISOString())
      results.push(result)
    }
    db.exec('COMMIT')
    return results
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export const createSyncServer = ({ db = openSyncDatabase(), token, objectDir = './jason-sync-objects', objectStorage = new FileSystemObjectStorage(objectDir) } = {}) => {
  if (!token) throw new Error('JASON_SYNC_TOKEN_REQUIRED')
  mkdirSync(join(objectDir, 'tmp'), { recursive: true }); mkdirSync(join(objectDir, 'objects'), { recursive: true })
  return createHttpServer(async (request, response) => {
  try {
    if (request.method === 'OPTIONS') { response.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS' }); return response.end() }
    if (request.url === '/health') return json(response, 200, { ok: true, protocolVersion: PROTOCOL_VERSION, serverSchemaVersion: SERVER_SCHEMA_VERSION, minSupportedVersion: MIN_SUPPORTED_VERSION })
    if (request.headers.authorization !== `Bearer ${token}`) return json(response, 401, { error: 'UNAUTHORIZED' })
    const url = new URL(request.url, 'http://localhost')
    if (request.method === 'POST' && url.pathname === '/devices/register') {
      const value = await body(request)
      db.prepare('INSERT INTO devices VALUES(?,?,?,?,?,?,?,NULL) ON CONFLICT(device_id) DO UPDATE SET name=excluded.name,platform=excluded.platform,app_version=excluded.app_version,schema_version=excluded.schema_version,protocol_version=excluded.protocol_version,last_seen_at=excluded.last_seen_at').run(value.deviceId, value.name, value.platform, value.appVersion, value.schemaVersion, value.protocolVersion, new Date().toISOString())
      return json(response, 200, { ok: true })
    }
    if (request.method === 'GET' && url.pathname === '/devices') return json(response, 200, { devices: db.prepare('SELECT * FROM devices ORDER BY last_seen_at DESC').all() })
    if (request.method === 'DELETE' && url.pathname.startsWith('/devices/')) {
      db.prepare('UPDATE devices SET revoked_at=? WHERE device_id=?').run(new Date().toISOString(), url.pathname.split('/').at(-1)); return json(response, 200, { ok: true })
    }
    if (request.method === 'GET' && url.pathname === '/conflicts') return json(response, 200, { conflicts: db.prepare('SELECT * FROM conflicts WHERE resolved_at IS NULL ORDER BY created_at DESC').all() })
    if (request.method === 'POST' && url.pathname.startsWith('/conflicts/') && url.pathname.endsWith('/resolve')) {
      const value = await body(request); const conflictId = url.pathname.split('/')[2]
      const conflict = db.prepare('SELECT * FROM conflicts WHERE conflict_id=? AND resolved_at IS NULL').get(conflictId)
      if (!conflict) return json(response, 404, { error: 'CONFLICT_NOT_FOUND' })
      const remote = JSON.parse(conflict.remote_payload_json); const local = JSON.parse(conflict.local_payload_json)
      const timerConflict = conflict.entity_type === 'timeLogs' && JSON.parse(conflict.fields_json).includes('timeRange')
      const timerResolution = timerConflict && ['KEEP_A', 'KEEP_B', 'KEEP_BOTH_WITH_WARNING', 'ADJUST'].includes(value.resolution)
      const payload = timerResolution
        ? value.resolution === 'KEEP_A' ? remote
          : value.resolution === 'ADJUST' ? { ...local, ...(value.payload || {}) }
            : value.resolution === 'KEEP_BOTH_WITH_WARNING' ? { ...local, excludedFromTotals: true, overlapWarning: true }
              : local
        : value.resolution === 'KEEP_REMOTE' ? remote : value.resolution === 'MERGE' ? { ...remote, ...(value.payload || {}) } : { ...remote, ...local }
      if (timerConflict && value.resolution === 'ADJUST' && findTimerOverlap(db, { workspaceId: conflict.workspace_id, entityType: 'timeLogs', entityId: conflict.entity_id, operation: 'CREATE', payload })) return json(response, 409, { error: 'TIME_RANGE_STILL_OVERLAPS' })
      if (timerConflict && value.resolution === 'KEEP_A') {
        db.prepare('UPDATE conflicts SET resolved_at=?,resolution=? WHERE conflict_id=?').run(new Date().toISOString(), value.resolution, conflictId)
        return json(response, 200, { ok: true, payload: remote, excludedFromTotals: false })
      }
      if (timerConflict && value.resolution === 'KEEP_B' && remote.id && remote.id !== conflict.entity_id) {
        const prior = db.prepare('SELECT revision,payload_json FROM records WHERE workspace_id=? AND entity_type=? AND entity_id=?').get(conflict.workspace_id, 'timeLogs', remote.id)
        if (prior) {
          const deletedAt = new Date().toISOString(); const deleted = { ...JSON.parse(prior.payload_json), deletedAt }
          db.prepare('UPDATE records SET payload_json=?,revision=?,deleted_at=? WHERE workspace_id=? AND entity_type=? AND entity_id=?').run(JSON.stringify(deleted), prior.revision + 1, deletedAt, conflict.workspace_id, 'timeLogs', remote.id)
          insertChange(db, { mutationId: `resolve-${conflictId}-delete-a`, workspaceId: conflict.workspace_id, entityType: 'timeLogs', entityId: remote.id, operation: 'DELETE' }, prior.revision + 1, deleted)
        }
      }
      const existing = db.prepare('SELECT revision FROM records WHERE workspace_id=? AND entity_type=? AND entity_id=?').get(conflict.workspace_id, conflict.entity_type, conflict.entity_id)
      const revision = (existing?.revision || 0) + 1; const mutation = { mutationId: `resolve-${conflictId}`, workspaceId: conflict.workspace_id, entityType: conflict.entity_type, entityId: conflict.entity_id, operation: existing ? 'UPDATE' : 'CREATE' }
      db.prepare('INSERT INTO records(workspace_id,entity_type,entity_id,payload_json,revision,deleted_at) VALUES(?,?,?,?,?,NULL) ON CONFLICT(workspace_id,entity_type,entity_id) DO UPDATE SET payload_json=excluded.payload_json,revision=excluded.revision,deleted_at=NULL').run(conflict.workspace_id, conflict.entity_type, conflict.entity_id, JSON.stringify(payload), revision)
      db.prepare('INSERT INTO record_revisions VALUES(?,?,?,?,?,?)').run(conflict.workspace_id, conflict.entity_type, conflict.entity_id, revision, conflict.fields_json, JSON.stringify(payload))
      const serverSequence = insertChange(db, mutation, revision, payload)
      db.prepare('UPDATE conflicts SET resolved_at=?,resolution=? WHERE conflict_id=?').run(new Date().toISOString(), value.resolution, conflictId)
      return json(response, 200, { ok: true, serverRevision: revision, serverSequence, payload })
    }
    if (request.method === 'POST' && url.pathname === '/timers/lease') {
      const value = await body(request); const workspace = value.workspaceId || 'local'; const active = db.prepare('SELECT * FROM timer_leases WHERE workspace_id=? AND lease_expires_at>?').get(workspace, new Date().toISOString())
      if (active && active.device_id !== value.deviceId) return json(response, 409, { error: 'TIMER_LEASE_HELD', lease: active })
      const expires = new Date(Date.now() + Math.max(30, Math.min(300, value.ttlSeconds || 60)) * 1000).toISOString()
      db.prepare('INSERT INTO timer_leases VALUES(?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET device_id=excluded.device_id,session_id=excluded.session_id,started_at=excluded.started_at,lease_expires_at=excluded.lease_expires_at').run(workspace, value.deviceId, value.sessionId, value.startedAt || new Date().toISOString(), expires)
      return json(response, 200, { ok: true, leaseExpiresAt: expires })
    }
    if (request.method === 'DELETE' && url.pathname === '/timers/lease') {
      const value = await body(request); db.prepare('DELETE FROM timer_leases WHERE workspace_id=? AND device_id=? AND session_id=?').run(value.workspaceId || 'local', value.deviceId, value.sessionId); return json(response, 200, { ok: true })
    }
    if (request.method === 'POST' && url.pathname === '/sync/push') {
      const value = await body(request)
      return json(response, 200, { results: pushMutations(db, value.mutations || []) })
    }
    if (request.method === 'POST' && url.pathname === '/files/init') {
      const value = await body(request)
      const existing = db.prepare('SELECT file_id AS fileId,object_key AS objectKey FROM file_assets WHERE workspace_id=? AND sha256=? AND deleted_at IS NULL').get(value.workspaceId || 'local', value.sha256)
      if (existing) return json(response, 200, { deduplicated: true, ...existing })
      const uploadId = randomUUID(); const tempPath = join(objectDir, 'tmp', uploadId)
      writeFileSync(tempPath, '')
      db.prepare('INSERT INTO file_uploads VALUES(?,?,?,?,?,?,0,?)').run(uploadId, value.workspaceId || 'local', value.sha256, value.size, value.mimeType || 'application/octet-stream', tempPath, new Date().toISOString())
      return json(response, 200, { deduplicated: false, uploadId, offset: 0, chunkSize: 2 * 1024 * 1024 })
    }
    if (request.method === 'PUT' && url.pathname.startsWith('/files/chunk/')) {
      const uploadId = url.pathname.split('/').at(-1); const upload = db.prepare('SELECT * FROM file_uploads WHERE upload_id=?').get(uploadId)
      if (!upload) return json(response, 404, { error: 'UPLOAD_NOT_FOUND' })
      const offset = Number(url.searchParams.get('offset') || 0)
      if (offset !== upload.received) return json(response, 409, { error: 'OFFSET_MISMATCH', expectedOffset: upload.received })
      const chunks = []; for await (const chunk of request) chunks.push(chunk); const bytes = Buffer.concat(chunks)
      appendFileSync(upload.temp_path, bytes); db.prepare('UPDATE file_uploads SET received=received+? WHERE upload_id=?').run(bytes.length, uploadId)
      return json(response, 200, { offset: offset + bytes.length })
    }
    if (request.method === 'POST' && url.pathname.startsWith('/files/complete/')) {
      const uploadId = url.pathname.split('/').at(-1); const upload = db.prepare('SELECT * FROM file_uploads WHERE upload_id=?').get(uploadId)
      if (!upload) return json(response, 404, { error: 'UPLOAD_NOT_FOUND' })
      if (statSync(upload.temp_path).size !== upload.size) return json(response, 409, { error: 'SIZE_MISMATCH' })
      const actual = createHash('sha256').update(readFileSync(upload.temp_path)).digest('hex')
      if (actual !== upload.sha256) return json(response, 422, { error: 'CHECKSUM_MISMATCH' })
      const objectKey = `${upload.workspace_id}/${actual}`
      await objectStorage.put(objectKey, readFileSync(upload.temp_path), upload.mime_type); rmSync(upload.temp_path, { force: true })
      const fileId = randomUUID(); db.prepare('INSERT INTO file_assets VALUES(?,?,?,?,?,?,?,NULL)').run(fileId, upload.workspace_id, actual, upload.size, upload.mime_type, objectKey, new Date().toISOString()); db.prepare('DELETE FROM file_uploads WHERE upload_id=?').run(uploadId)
      return json(response, 200, { fileId, objectKey, sha256: actual, state: 'AVAILABLE' })
    }
    if (request.method === 'GET' && url.pathname.startsWith('/files/object/')) {
      const sha = url.pathname.split('/').at(-1); const asset = db.prepare('SELECT object_key,mime_type,size FROM file_assets WHERE sha256=? AND deleted_at IS NULL').get(sha)
      if (!asset) return json(response, 404, { error: 'FILE_NOT_FOUND' })
      const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || ''); const start = match ? Number(match[1]) : 0; const end = match ? Math.min(Number(match[2] || asset.size - 1), asset.size - 1) : asset.size - 1
      const bytes = await objectStorage.get(asset.object_key, match ? { start, end } : undefined); if (!bytes) return json(response, 404, { error: 'FILE_NOT_FOUND' })
      const headers = { 'content-length': bytes.length, 'content-type': asset.mime_type || 'application/octet-stream', 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' }
      if (match) headers['content-range'] = `bytes ${start}-${end}/${asset.size}`
      response.writeHead(match ? 206 : 200, headers); return response.end(bytes)
    }
    if (request.method === 'GET' && url.pathname === '/sync/pull') {
      const cursor = Number(url.searchParams.get('cursor') || 0)
      const workspace = url.searchParams.get('workspaceId') || 'local'
      const minimum = Number(db.prepare('SELECT coalesce(min(server_sequence),0) AS value FROM changes WHERE workspace_id=?').get(workspace).value)
      if (cursor > 0 && minimum > cursor + 1) return json(response, 410, { error: 'CURSOR_EXPIRED' })
      const changes = db.prepare('SELECT server_sequence AS serverSequence,entity_type AS entityType,entity_id AS entityId,operation,revision AS serverRevision,payload_json AS payload FROM changes WHERE workspace_id=? AND server_sequence>? ORDER BY server_sequence LIMIT 500').all(workspace, cursor).map((row) => ({ ...row, payload: JSON.parse(row.payload) }))
      return json(response, 200, { changes, nextCursor: changes.at(-1)?.serverSequence || cursor })
    }
    if (request.method === 'GET' && url.pathname === '/sync/snapshot') {
      const workspace = url.searchParams.get('workspaceId') || 'local'
      const records = db.prepare('SELECT entity_type AS entityType,entity_id AS entityId,revision AS serverRevision,payload_json AS payload FROM records WHERE workspace_id=?').all(workspace).map((row) => ({ ...row, payload: JSON.parse(row.payload) }))
      const cursor = Number(db.prepare('SELECT coalesce(max(server_sequence),0) AS value FROM changes WHERE workspace_id=?').get(workspace).value)
      return json(response, 200, { records, snapshotCursor: cursor })
    }
    return json(response, 404, { error: 'NOT_FOUND' })
  } catch (error) {
    json(response, error.message === 'UPGRADE_REQUIRED' ? 426 : 400, { error: error.message })
  }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.JASON_SYNC_PORT || 8787)
  const db = openSyncDatabase(process.env.JASON_SYNC_DB || './jason-sync.sqlite3')
  const objectDir = process.env.JASON_SYNC_OBJECT_DIR || './jason-sync-objects'
  const objectStorage = process.env.JASON_SYNC_S3_ENDPOINT ? new S3ObjectStorage({ endpoint: process.env.JASON_SYNC_S3_ENDPOINT, bucket: process.env.JASON_SYNC_S3_BUCKET || 'jason-sync', accessKeyId: process.env.JASON_SYNC_S3_ACCESS_KEY || '', secretAccessKey: process.env.JASON_SYNC_S3_SECRET_KEY || '' }) : new FileSystemObjectStorage(objectDir)
  if (objectStorage.ensureBucket) await objectStorage.ensureBucket()
  const token = process.env.JASON_SYNC_TOKEN
  if (!token) throw new Error('JASON_SYNC_TOKEN_REQUIRED')
  createSyncServer({ db, token, objectDir, objectStorage }).listen(port, '127.0.0.1', () => console.log(`Jason Sync Server listening on http://127.0.0.1:${port}`))
}
